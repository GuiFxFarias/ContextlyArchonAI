import OpenAI from "openai";
import { NextResponse } from "next/server";
import { embedQuery } from "@/lib/rag/embeddings";
import { formatChunksForPrompt } from "@/lib/rag/prompt";
import { rerankMatches, vectorCandidateCount } from "@/lib/rag/rerank";
import { searchSimilarChunks } from "@/lib/rag/search";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      fields?: unknown;
      documentIds?: unknown;
    };

    const fields = Array.isArray(body.fields)
      ? (body.fields as unknown[])
          .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
          .map((f) => f.trim())
      : [];

    if (fields.length === 0) {
      return NextResponse.json(
        { error: "Informe ao menos um campo para extrair." },
        { status: 400 }
      );
    }

    let documentIds: string[] | null = null;
    if (Array.isArray(body.documentIds)) {
      if ((body.documentIds as unknown[]).length === 0) {
        return NextResponse.json(
          { error: "Selecione pelo menos um documento." },
          { status: 400 }
        );
      }
      documentIds = (body.documentIds as unknown[]).filter(
        (id): id is string => typeof id === "string"
      );
    }

    const supabase = getSupabaseAdmin();
    const query = fields.join(", ");
    const queryEmbedding = await embedQuery(query);
    const vectorPool = vectorCandidateCount();
    const vectorMatches = await searchSimilarChunks(supabase, queryEmbedding, {
      matchCount: vectorPool,
      documentIds,
    });

    if (!vectorMatches.length) {
      return NextResponse.json({
        results: fields.map((f) => ({ field: f, value: null })),
        sources: [],
      });
    }

    const { matches } = await rerankMatches(query, vectorMatches, 6);

    const docIds = [...new Set(matches.map((m) => m.document_id))];
    const { data: docs } = await supabase
      .from("documents")
      .select("id, name")
      .in("id", docIds);
    const nameById = new Map(
      (docs ?? []).map((d) => [d.id as string, d.name as string])
    );

    const formatted = formatChunksForPrompt(
      matches.map((m) => ({
        content: m.content,
        metadata: m.metadata as Record<string, unknown>,
        documentName: nameById.get(m.document_id),
      }))
    );

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Configure OPENAI_API_KEY no ambiente." },
        { status: 500 }
      );
    }
    const openai = new OpenAI({ apiKey });

    const contextBlock = formatted.join("\n\n");
    const fieldsJson = JSON.stringify(fields);

    const systemPrompt = `Você é um extrator de dados estruturados. Extraia os campos solicitados a partir do contexto fornecido e retorne SOMENTE um JSON válido, sem markdown e sem explicações.

Regras:
- Se um campo tiver apenas um valor, retorne uma string: {"CNPJ": "12.345.678/0001-90"}
- Se um campo aparecer múltiplas vezes no contexto (ex: vários CNPJs, várias partes), retorne um array com todos os valores encontrados: {"CNPJ": ["12.345.678/0001-90", "98.765.432/0001-10"]}
- Se um campo não for encontrado no contexto, use null
- Não invente valores; extraia apenas o que está explicitamente no contexto`;

    const userPrompt = `Contexto:\n${contextBlock}\n\nCampos a extrair: ${fieldsJson}\n\nRetorne apenas o JSON com os valores.`;

    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let extracted: Record<string, string | string[] | null> = {};
    try {
      extracted = JSON.parse(raw) as Record<string, string | string[] | null>;
    } catch {
      extracted = {};
    }

    const results = fields.map((f) => {
      if (f in extracted) return { field: f, value: extracted[f] };
      const key = Object.keys(extracted).find(
        (k) => k.toLowerCase() === f.toLowerCase()
      );
      return { field: f, value: key ? extracted[key] : null };
    });

    const sources = matches.map((m) => ({
      id: m.id,
      documentId: m.document_id,
      documentName: nameById.get(m.document_id) ?? "Documento",
      chunkIndex:
        typeof (m.metadata as Record<string, unknown>).chunkIndex === "number"
          ? ((m.metadata as Record<string, unknown>).chunkIndex as number)
          : 0,
      preview: m.content.slice(0, 200).replace(/\s+/g, " ").trim(),
      similarity: m.similarity,
    }));

    return NextResponse.json({ results, sources });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha na extração.";
    console.error(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
