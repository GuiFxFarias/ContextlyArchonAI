import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o";

type ComplianceBody = {
  standardDocId?: unknown;
  analysisDocId?: unknown;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ComplianceBody;

    const standardDocId =
      typeof body.standardDocId === "string" ? body.standardDocId : null;
    const analysisDocId =
      typeof body.analysisDocId === "string" ? body.analysisDocId : null;

    if (!standardDocId || !analysisDocId) {
      return NextResponse.json(
        { error: "Informe standardDocId e analysisDocId." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data: docs } = await supabase
      .from("documents")
      .select("id, name")
      .in("id", [standardDocId, analysisDocId]);

    const nameById = new Map(
      (docs ?? []).map((d) => [d.id as string, d.name as string])
    );
    const standardName = nameById.get(standardDocId) ?? "Documento Padrão";
    const analysisName = nameById.get(analysisDocId) ?? "Documento em Análise";

    const [{ data: standardChunks }, { data: analysisChunks }] =
      await Promise.all([
        supabase
          .from("embeddings")
          .select("content")
          .eq("document_id", standardDocId)
          .limit(20),
        supabase
          .from("embeddings")
          .select("content")
          .eq("document_id", analysisDocId)
          .limit(20),
      ]);

    if (!standardChunks?.length) {
      return NextResponse.json(
        { error: "Documento padrão não encontrado ou sem conteúdo." },
        { status: 404 }
      );
    }
    if (!analysisChunks?.length) {
      return NextResponse.json(
        { error: "Documento em análise não encontrado ou sem conteúdo." },
        { status: 404 }
      );
    }

    const standardText = standardChunks.map((c) => c.content).join("\n\n");
    const analysisText = analysisChunks.map((c) => c.content).join("\n\n");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Configure OPENAI_API_KEY no ambiente." },
        { status: 500 }
      );
    }
    const openai = new OpenAI({ apiKey });

    const systemPrompt = `Você é um especialista em conformidade documental. Compare um documento em análise com um documento padrão de referência e identifique todas as divergências, ausências e não-conformidades.

Retorne SOMENTE um JSON válido (sem markdown) com esta estrutura exata:
{
  "status": "conforme" | "parcialmente_conforme" | "nao_conforme",
  "score": <número inteiro 0-100>,
  "divergencias": [
    { "item": "<nome do item/cláusula>", "esperado": "<o que o padrão estabelece>", "encontrado": "<o que está no documento analisado>", "gravidade": "alta" | "media" | "baixa" }
  ],
  "ausencias": ["<cláusula ou item presente no padrão mas ausente no documento analisado>"],
  "observacoes": "<texto com avaliação geral da conformidade>"
}

Critérios de score:
- 90-100 → conforme
- 60-89 → parcialmente_conforme
- 0-59 → nao_conforme

Seja específico, objetivo e baseie-se apenas no conteúdo fornecido.`;

    const userPrompt = `DOCUMENTO PADRÃO — "${standardName}":
${standardText}

---

DOCUMENTO EM ANÁLISE — "${analysisName}":
${analysisText}

---

Compare os dois e retorne o JSON de conformidade.`;

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
    let result: Record<string, unknown> = {};
    try {
      result = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      result = {};
    }

    return NextResponse.json({
      status: result.status ?? "nao_conforme",
      score: typeof result.score === "number" ? result.score : 0,
      divergencias: Array.isArray(result.divergencias) ? result.divergencias : [],
      ausencias: Array.isArray(result.ausencias) ? result.ausencias : [],
      observacoes: typeof result.observacoes === "string" ? result.observacoes : "",
      standardName,
      analysisName,
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Falha na verificação de conformidade.";
    console.error(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
