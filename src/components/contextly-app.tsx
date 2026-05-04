'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  BrainCircuit,
  ChevronDown,
  FileText,
  FileUp,
  Loader2,
  MessageSquare,
  PanelLeft,
  Plus,
  SendHorizontal,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { RetrievalReasoning } from '@/lib/rag/reasoning';
import { AssistantMarkdown } from '@/components/assistant-markdown';

type DocumentRow = { id: string; name: string; created_at: string };

type SourceInfo = {
  id: string;
  documentId: string;
  documentName: string;
  chunkIndex: number;
  preview: string;
  similarity: number;
  rerankScore?: number;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceInfo[];
  reasoning?: RetrievalReasoning;
};

type QueryScope = { kind: 'all' } | { kind: 'subset'; ids: string[] };
type ExtractResult = { field: string; value: string | string[] | null };

const EXTRACT_TEMPLATES: Record<string, string[]> = {
  Contrato: [
    'CNPJ',
    'Razão Social',
    'Valor do Contrato',
    'Data de Início',
    'Data de Término',
    'Objeto do Contrato',
  ],
  'Nota Fiscal': [
    'CNPJ Emitente',
    'Razão Social Emitente',
    'Número da NF',
    'Data de Emissão',
    'Valor Total',
    'CFOP',
  ],
  'Cupom Fiscal': ['CNPJ', 'Data', 'Valor Total', 'Forma de Pagamento'],
  Laudo: ['Paciente', 'Data', 'Conclusão', 'Responsável Técnico'],
  'Acordo Extrajudicial': [
    'Nome/Razão Social do Credor',
    'CNPJ do Credor',
    'Nome do Devedor',
    'CPF do Devedor',
    'Valor total da dívida original',
    'Valor total com desconto',
    'Percentual de desconto concedido',
    'Data de assinatura do acordo',
    'Número das Notas Fiscais relacionadas',
    'Valor da parcela de entrada',
  ],
  'Honorários Advocatícios': [
    'Nome/Razão Social do Contratante',
    'CNPJ do Contratante',
    'Nome do Escritório Contratado',
    'Nome do Advogado Responsável',
    'OAB do Advogado Responsável',
    'Valor dos honorários mensais',
    'Percentual de honorários de êxito',
    'Data de início do contrato',
    'Data de término do contrato',
    'Prazo de aviso para rescisão (dias)',
  ],
  'Procuração Ad Judicia': [
    'Nome completo do Outorgante',
    'CPF do Outorgante',
    'Nome do Escritório Outorgado',
    'Nomes dos Advogados Outorgados',
    'Números OAB dos Advogados Outorgados',
    'CNPJ do Escritório Outorgado',
    'Data de emissão da procuração',
    'Prazo de validade da procuração',
    'Finalidade/objeto da procuração',
    'Foro eleito',
  ],
};

function CollapsibleBlock({
  title,
  icon: Icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className='group overflow-hidden rounded-xl border border-border bg-muted/25 open:bg-muted/40'
      open={defaultOpen}
    >
      <summary className='flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-foreground transition-colors hover:bg-muted/50 [&::-webkit-details-marker]:hidden'>
        <ChevronDown
          className='size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180'
          aria-hidden
        />
        <Icon className='size-4 shrink-0 text-primary' aria-hidden />
        {title}
      </summary>
      <div className='border-t border-border/70 px-3 py-3 text-sm'>
        {children}
      </div>
    </details>
  );
}

function formatDocDate(iso: string) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

export function ContextlyApp() {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [queryScope, setQueryScope] = useState<QueryScope>({ kind: 'all' });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activeTab, setActiveTab] = useState<'chat' | 'extract'>('extract');
  const [extractFields, setExtractFields] = useState<string[]>([]);
  const [fieldInput, setFieldInput] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractResults, setExtractResults] = useState<ExtractResult[] | null>(
    null,
  );
  const [extractSources, setExtractSources] = useState<SourceInfo[]>([]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
  };

  const loadDocuments = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      const list = (data.documents ?? []) as DocumentRow[];
      setDocuments(list);
      setQueryScope((prev) => {
        if (prev.kind === 'all') return prev;
        const allowed = new Set(list.map((d) => d.id));
        const ids = prev.ids.filter((id) => allowed.has(id));
        if (ids.length === 0) return { kind: 'all' };
        if (ids.length === list.length) return { kind: 'all' };
        return { kind: 'subset', ids };
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);
  useEffect(() => {
    scrollToBottom();
  }, [messages, sending]);

  const toggleScope = (id: string) => {
    const allIds = documents.map((d) => d.id);
    setQueryScope((prev) => {
      if (prev.kind === 'all') {
        return { kind: 'subset', ids: allIds.filter((x) => x !== id) };
      }
      const set = new Set(prev.ids);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      const ids = Array.from(set);
      if (ids.length === 0) return { kind: 'subset', ids: [] };
      if (ids.length === allIds.length) return { kind: 'all' };
      return { kind: 'subset', ids };
    });
  };

  const onUploadClick = () => fileInputRef.current?.click();

  const onFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (list.length === 0) return;
    setUploading(true);
    const errors: string[] = [];
    try {
      for (const file of list) {
        try {
          const fd = new FormData();
          fd.set('file', file);
          const res = await fetch('/api/upload', { method: 'POST', body: fd });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? 'Upload failed');
        } catch (err) {
          errors.push(
            `${err instanceof Error ? err.message : 'Falha'} — ${file.name}`,
          );
        }
      }
      await loadDocuments();
      if (list.length > errors.length) setQueryScope({ kind: 'all' });
      if (errors.length > 0) {
        const ok = list.length - errors.length;
        alert(
          (ok > 0
            ? `${ok} arquivo(s) OK, ${errors.length} com erro:\n\n`
            : 'Nenhum arquivo enviado:\n\n') + errors.join('\n'),
        );
      }
    } finally {
      setUploading(false);
    }
  };

  const deleteDocument = async (id: string) => {
    if (!confirm('Remover este documento da base de conhecimento?')) return;
    try {
      const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed');
      setQueryScope((prev) => {
        if (prev.kind === 'all') return prev;
        const ids = prev.ids.filter((x) => x !== id);
        return ids.length === 0 ? { kind: 'all' } : { kind: 'subset', ids };
      });
      await loadDocuments();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erro ao remover');
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (queryScope.kind === 'subset' && queryScope.ids.length === 0) {
      alert('Selecione ao menos um documento.');
      return;
    }
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    };
    const assistantId = crypto.randomUUID();
    setMessages((m) => [
      ...m,
      userMsg,
      { id: assistantId, role: 'assistant', content: '' },
    ]);
    setInput('');
    setSending(true);
    const documentIds = queryScope.kind === 'all' ? null : queryScope.ids;
    const history = messages
      .filter((m) => m.content.trim())
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content.trim(),
      }))
      .slice(-24);
    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, documentIds, history }),
      });
      if (!res.ok || !res.body) {
        throw new Error(
          (await res.json().catch(() => ({}))).error ?? 'Request failed',
        );
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf('\n');
        while (idx !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          idx = buf.indexOf('\n');
          if (!line) continue;
          const evt = JSON.parse(line) as
            | {
                type: 'sources';
                sources: SourceInfo[];
                reasoning?: RetrievalReasoning;
              }
            | { type: 'text'; text: string }
            | { type: 'done' }
            | { type: 'error'; message: string };
          if (evt.type === 'sources') {
            setMessages((prev) =>
              prev.map((x) =>
                x.id === assistantId
                  ? {
                      ...x,
                      sources: evt.sources,
                      reasoning: evt.reasoning ?? x.reasoning,
                    }
                  : x,
              ),
            );
          } else if (evt.type === 'text') {
            setMessages((prev) =>
              prev.map((x) =>
                x.id === assistantId
                  ? { ...x, content: x.content + evt.text }
                  : x,
              ),
            );
          } else if (evt.type === 'error') {
            setMessages((prev) =>
              prev.map((x) =>
                x.id === assistantId ? { ...x, content: evt.message } : x,
              ),
            );
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Algo deu errado';
      setMessages((prev) =>
        prev.map((x) => (x.id === assistantId ? { ...x, content: msg } : x)),
      );
    } finally {
      setSending(false);
    }
  };

  // ── extraction ──────────────────────────────────────────────────────────────

  const addField = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !extractFields.includes(trimmed))
      setExtractFields((prev) => [...prev, trimmed]);
  };

  const removeField = (field: string) =>
    setExtractFields((prev) => prev.filter((f) => f !== field));

  const applyTemplate = (fields: string[]) => {
    setExtractFields(fields);
    setExtractResults(null);
    setExtractSources([]);
  };

  const runExtract = async () => {
    if (extractFields.length === 0 || extracting) return;
    if (queryScope.kind === 'subset' && queryScope.ids.length === 0) {
      alert('Selecione ao menos um documento.');
      return;
    }
    setExtracting(true);
    setExtractResults(null);
    setExtractSources([]);
    try {
      const documentIds = queryScope.kind === 'all' ? null : queryScope.ids;
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: extractFields, documentIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Falha na extração');
      setExtractResults(data.results as ExtractResult[]);
      setExtractSources((data.sources ?? []) as SourceInfo[]);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erro na extração');
    } finally {
      setExtracting(false);
    }
  };

  // ── sidebar ─────────────────────────────────────────────────────────────────

  const sidebarContent = (
    <div className='flex h-full flex-col'>
      {/* header */}
      <div className='flex items-center gap-3 px-4 py-4'>
        <div className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground'>
          <Sparkles className='size-4' aria-hidden />
        </div>
        <div className='min-w-0'>
          <p className='text-sm font-semibold tracking-tight'>Contextly</p>
          <p className='text-[11px] text-muted-foreground'>
            Base de documentos
          </p>
        </div>
      </div>

      <Separator />

      {/* upload */}
      <div className='p-3'>
        <input
          ref={fileInputRef}
          type='file'
          multiple
          accept='.pdf,.txt,text/plain,application/pdf'
          className='hidden'
          onChange={onFileSelected}
        />
        <Button
          className='w-full gap-2'
          onClick={onUploadClick}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2 className='size-4 animate-spin' />
          ) : (
            <FileUp className='size-4' />
          )}
          Enviar arquivo
        </Button>
      </div>

      <Separator />

      {/* document list */}
      <div className='flex items-center justify-between px-4 py-2'>
        <span className='text-[11px] font-semibold uppercase tracking-widest text-muted-foreground'>
          Documentos
        </span>
        <div className='flex items-center gap-1.5'>
          {loadingDocs ? (
            <Loader2 className='size-3 animate-spin text-muted-foreground' />
          ) : (
            <Badge
              variant='secondary'
              className='h-4 px-1.5 text-[10px] font-semibold'
            >
              {documents.length}
            </Badge>
          )}
        </div>
      </div>

      <ScrollArea className='min-h-0 flex-1 px-2 pb-2'>
        <ul className='space-y-0.5'>
          {documents.length === 0 && !loadingDocs ? (
            <li className='px-2 py-6 text-center text-xs text-muted-foreground'>
              Nenhum documento ainda.
            </li>
          ) : null}
          {documents.map((d) => {
            const checked =
              queryScope.kind === 'all' || queryScope.ids.includes(d.id);
            return (
              <li
                key={d.id}
                className='group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60 transition-colors'
              >
                <input
                  type='checkbox'
                  checked={checked}
                  onChange={() => toggleScope(d.id)}
                  className='shrink-0 rounded border-input accent-primary cursor-pointer'
                />
                <div className='min-w-0 flex-1'>
                  <p
                    className='truncate text-[13px] font-medium leading-tight'
                    title={d.name}
                  >
                    {d.name}
                  </p>
                  <p className='text-[10px] text-muted-foreground'>
                    {formatDocDate(d.created_at)}
                  </p>
                </div>
                <Button
                  variant='ghost'
                  size='icon'
                  className='size-7 shrink-0 opacity-0 group-hover:opacity-60 hover:opacity-100! transition-opacity'
                  onClick={() => void deleteDocument(d.id)}
                  aria-label={`Remover ${d.name}`}
                >
                  <Trash2 className='size-3.5' />
                </Button>
              </li>
            );
          })}
        </ul>
      </ScrollArea>

      {/* scope hint */}
      {queryScope.kind === 'subset' && (
        <div className='border-t border-border px-3 py-2'>
          <p className='text-[11px] text-muted-foreground'>
            <span className='font-semibold text-primary'>
              {queryScope.ids.length}
            </span>{' '}
            de {documents.length} selecionados
          </p>
        </div>
      )}
    </div>
  );

  // ── chat panel ──────────────────────────────────────────────────────────────

  const chatPanel = (
    <>
      <ScrollArea className='min-h-0 flex-1'>
        <div className='mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8'>
          {messages.length === 0 ? (
            <div className='rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-14 text-center'>
              <MessageSquare className='mx-auto size-9 text-muted-foreground/50' />
              <h2 className='mt-4 text-base font-semibold tracking-tight'>
                Converse com seus documentos
              </h2>
              <p className='mt-1.5 text-sm text-muted-foreground'>
                Faça perguntas e receba respostas embasadas nos documentos
                carregados.
              </p>
            </div>
          ) : null}

          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                'flex flex-col gap-2',
                m.role === 'user' ? 'items-end' : 'items-start',
              )}
            >
              <div
                className={cn(
                  'max-w-[85%] min-w-0 rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm',
                  m.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'flex min-h-0 flex-col border border-border bg-card text-card-foreground',
                )}
              >
                {m.role === 'assistant' ? (
                  m.content ? (
                    <div
                      className={cn(
                        'min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain [-webkit-overflow-scrolling:touch]',
                        'max-h-[min(72dvh,34rem)] sm:max-h-[min(70dvh,36rem)]',
                      )}
                      tabIndex={0}
                    >
                      <AssistantMarkdown content={m.content} />
                    </div>
                  ) : sending ? (
                    <span className='inline-flex items-center gap-2 text-muted-foreground'>
                      <Loader2 className='size-4 animate-spin' />
                      Pensando…
                    </span>
                  ) : null
                ) : (
                  m.content
                )}
              </div>

              {m.role === 'assistant' && (m.reasoning || m.sources?.length) ? (
                <div className='flex w-full max-w-[85%] flex-col gap-2'>
                  {m.reasoning ? (
                    <CollapsibleBlock
                      title='Como chegamos aqui'
                      icon={BrainCircuit}
                    >
                      <p className='mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
                        {m.reasoning.scopeLabel} · modelo {m.reasoning.model}
                      </p>
                      <ol className='list-decimal space-y-2 pl-4 text-xs leading-relaxed'>
                        {m.reasoning.steps.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                    </CollapsibleBlock>
                  ) : null}
                  <CollapsibleBlock
                    title={`Fontes consultadas${m.sources?.length ? ` (${m.sources.length})` : ''}`}
                    icon={FileText}
                  >
                    {!m.sources?.length ? (
                      <p className='text-xs text-muted-foreground'>
                        Nenhum trecho recuperado.
                      </p>
                    ) : (
                      <ul className='space-y-4'>
                        {m.sources.map((s, i) => {
                          const rank = i + 1;
                          const proxVec = (
                            Math.min(1, Math.max(0, s.similarity)) * 100
                          ).toFixed(1);
                          const rs = s.rerankScore;
                          const hasRerank = rs !== undefined;
                          const proxRerank = hasRerank
                            ? (Math.min(1, Math.max(0, rs)) * 100).toFixed(1)
                            : null;
                          const barPct = hasRerank
                            ? Math.min(100, Math.max(0, rs * 100))
                            : Math.min(100, Math.max(0, s.similarity * 100));
                          return (
                            <li key={s.id} className='flex gap-3 text-xs'>
                              <div className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-bold tabular-nums text-primary'>
                                {rank}
                              </div>
                              <div className='min-w-0 flex-1 space-y-1.5'>
                                <div>
                                  <p className='font-medium text-foreground'>
                                    {s.documentName}
                                  </p>
                                  <p className='text-[11px] text-muted-foreground'>
                                    Trecho nº {s.chunkIndex + 1}
                                  </p>
                                </div>
                                <div className='flex flex-wrap items-center gap-1.5'>
                                  {hasRerank ? (
                                    <Badge
                                      variant='secondary'
                                      className='font-normal'
                                    >
                                      Rerank: {proxRerank}%
                                    </Badge>
                                  ) : null}
                                  <Badge
                                    variant={
                                      hasRerank ? 'outline' : 'secondary'
                                    }
                                    className='font-normal'
                                  >
                                    Vetorial: {proxVec}%
                                  </Badge>
                                </div>
                                <div className='h-1 overflow-hidden rounded-full bg-muted'>
                                  <div
                                    className='h-full rounded-full bg-primary/70 transition-[width] duration-300'
                                    style={{ width: `${barPct}%` }}
                                  />
                                </div>
                                <p className='leading-relaxed text-muted-foreground'>
                                  {s.preview}
                                  {s.preview.length >= 200 ? '…' : ''}
                                </p>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </CollapsibleBlock>
                </div>
              ) : null}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className='border-t border-border bg-background/90 p-4 backdrop-blur supports-backdrop-filter:bg-background/70'>
        <div className='mx-auto flex max-w-3xl gap-2'>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='Faça uma pergunta sobre seus documentos…'
            className='min-h-13 resize-none rounded-xl'
            rows={2}
            disabled={sending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
          />
          <Button
            size='icon'
            className='size-13 shrink-0 rounded-xl'
            onClick={() => void sendMessage()}
            disabled={sending || !input.trim()}
            aria-label='Enviar'
          >
            {sending ? (
              <Loader2 className='size-5 animate-spin' />
            ) : (
              <SendHorizontal className='size-5' />
            )}
          </Button>
        </div>
      </div>
    </>
  );

  // ── extraction panel ────────────────────────────────────────────────────────

  const extractPanel = (
    <ScrollArea className='min-h-0 flex-1'>
      <div className='mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8'>
        {/* hero */}
        <div className='rounded-2xl border border-border bg-muted/20 px-6 py-6'>
          <div className='flex items-center gap-3 mb-2'>
            <div className='flex size-9 items-center justify-center rounded-xl bg-primary/10'>
              <Zap className='size-5 text-primary' aria-hidden />
            </div>
            <div>
              <h2 className='text-base font-semibold tracking-tight'>
                Extração de Dados
              </h2>
              <p className='text-xs text-muted-foreground'>
                ArchonAI · Powered by RAG
              </p>
            </div>
          </div>
          <p className='text-sm text-muted-foreground leading-relaxed'>
            Selecione um template ou adicione os campos que deseja extrair. O
            sistema localiza e retorna as informações diretamente do documento.
          </p>
        </div>

        {/* templates */}
        <div>
          <p className='mb-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground'>
            Templates
          </p>
          <div className='flex flex-wrap gap-2'>
            {Object.entries(EXTRACT_TEMPLATES).map(([name, fields]) => (
              <button
                key={name}
                onClick={() => applyTemplate(fields)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-sm font-medium transition-all',
                  extractFields.join(',') === fields.join(',')
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-muted/30 text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* fields */}
        <div>
          <p className='mb-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground'>
            Campos selecionados
          </p>
          <div className='mb-3 flex min-h-8 flex-wrap gap-2'>
            {extractFields.length === 0 ? (
              <p className='text-sm text-muted-foreground/60'>
                Nenhum campo ainda — escolha um template ou adicione abaixo.
              </p>
            ) : (
              extractFields.map((f) => (
                <span
                  key={f}
                  className='flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/8 px-3 py-0.5 text-sm font-medium text-primary'
                >
                  {f}
                  <button
                    onClick={() => removeField(f)}
                    className='rounded-full opacity-60 hover:opacity-100 hover:text-destructive transition-all'
                    aria-label={`Remover ${f}`}
                  >
                    <X className='size-3' />
                  </button>
                </span>
              ))
            )}
          </div>
          <div className='flex gap-2'>
            <Input
              value={fieldInput}
              onChange={(e) => setFieldInput(e.target.value)}
              placeholder='Adicionar campo personalizado…'
              className='flex-1 rounded-xl'
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  addField(fieldInput);
                  setFieldInput('');
                }
              }}
            />
            <Button
              variant='outline'
              size='icon'
              className='rounded-xl'
              onClick={() => {
                addField(fieldInput);
                setFieldInput('');
              }}
              disabled={!fieldInput.trim()}
              aria-label='Adicionar campo'
            >
              <Plus className='size-4' />
            </Button>
          </div>
        </div>

        {/* action */}
        <Button
          onClick={() => void runExtract()}
          disabled={extracting || extractFields.length === 0}
          className='gap-2 self-start rounded-xl px-5'
          size='lg'
        >
          {extracting ? (
            <Loader2 className='size-4 animate-spin' />
          ) : (
            <Zap className='size-4' />
          )}
          {extracting ? 'Extraindo…' : 'Extrair Campos'}
        </Button>

        {/* results */}
        {extractResults && (
          <div className='overflow-hidden rounded-2xl border border-border bg-card shadow-sm'>
            <div className='flex items-center gap-2.5 border-b border-border bg-muted/30 px-5 py-3.5'>
              <Sparkles className='size-4 text-primary' aria-hidden />
              <span className='text-sm font-semibold'>
                Resultado da Extração
              </span>
              <Badge
                variant={
                  extractResults.filter((r) => r.value !== null).length ===
                  extractResults.length
                    ? 'default'
                    : 'secondary'
                }
                className='ml-auto text-[11px]'
              >
                {extractResults.filter((r) => r.value !== null).length}/
                {extractResults.length} encontrados
              </Badge>
            </div>
            <div className='divide-y divide-border'>
              {extractResults.map(({ field, value }) => {
                const isEmpty =
                  value === null ||
                  (Array.isArray(value) && value.length === 0);
                const isMulti = Array.isArray(value) && value.length > 1;
                return (
                  <div key={field} className='flex items-start gap-4 px-5 py-3'>
                    <span className='flex w-44 shrink-0 items-start gap-1.5 pt-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                      {field}
                      {isMulti && (
                        <Badge
                          variant='secondary'
                          className='h-3.5 shrink-0 px-1 text-[10px]'
                        >
                          {(value as string[]).length}
                        </Badge>
                      )}
                    </span>
                    <div className='flex-1 text-sm leading-relaxed'>
                      {isEmpty ? (
                        <span className='italic text-muted-foreground/50'>
                          Não encontrado
                        </span>
                      ) : isMulti ? (
                        <ul className='space-y-1'>
                          {(value as string[]).map((v, i) => (
                            <li key={i} className='flex items-start gap-2'>
                              <span className='mt-2 size-1.5 shrink-0 rounded-full bg-primary/50' />
                              <span>{v}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className='text-foreground'>
                          {Array.isArray(value) ? value[0] : value}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* sources */}
        {extractResults && extractSources.length > 0 && (
          <CollapsibleBlock
            title={`Trechos consultados (${extractSources.length})`}
            icon={FileText}
          >
            <ul className='space-y-4'>
              {extractSources.map((s, i) => (
                <li key={s.id} className='flex gap-3 text-xs'>
                  <div className='flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-bold text-primary'>
                    {i + 1}
                  </div>
                  <div className='min-w-0 space-y-1'>
                    <p className='font-medium text-foreground'>
                      {s.documentName}
                    </p>
                    <p className='text-[11px] text-muted-foreground'>
                      Trecho nº {s.chunkIndex + 1} ·{' '}
                      {(s.similarity * 100).toFixed(1)}% similaridade
                    </p>
                    <p className='leading-relaxed text-muted-foreground'>
                      {s.preview}
                      {s.preview.length >= 200 ? '…' : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </CollapsibleBlock>
        )}
      </div>
    </ScrollArea>
  );

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className='flex h-dvh w-full overflow-hidden bg-background'>
      {/* desktop sidebar — collapsible */}
      <aside
        className={cn(
          'hidden md:flex md:flex-col shrink-0 overflow-hidden border-r border-border',
          'transition-[width] duration-200 ease-in-out',
          sidebarOpen ? 'w-64' : 'w-0 border-r-0',
        )}
      >
        {sidebarContent}
      </aside>

      <main className='flex min-w-0 flex-1 flex-col'>
        {/* top bar — unified for mobile + desktop */}
        <header className='flex shrink-0 py-4 items-stretch border-b border-border bg-background'>
          {/* mobile: sheet trigger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon'
                  className='md:hidden mx-1 my-1.5 size-8 rounded-lg'
                  aria-label='Abrir documentos'
                />
              }
            >
              <PanelLeft className='size-4' />
            </SheetTrigger>
            <SheetContent side='left' className='w-64 p-0'>
              <SheetHeader className='sr-only'>
                <SheetTitle>Documentos</SheetTitle>
              </SheetHeader>
              {sidebarContent}
            </SheetContent>
          </Sheet>

          {/* desktop: sidebar toggle */}
          <button
            className={cn(
              'hidden md:flex items-center gap-2 px-3 text-sm transition-colors border-r border-border',
              sidebarOpen
                ? 'text-foreground bg-muted/40'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/30',
            )}
            onClick={() => setSidebarOpen((p) => !p)}
            aria-label={
              sidebarOpen
                ? 'Fechar painel de arquivos'
                : 'Abrir painel de arquivos'
            }
          >
            <PanelLeft
              className={cn(
                'size-4 transition-transform duration-200',
                sidebarOpen && 'rotate-180',
              )}
            />
            <span className='text-xs font-medium'>Arquivos</span>
            {documents.length > 0 && (
              <Badge
                variant='secondary'
                className='h-4 px-1.5 text-[10px] font-semibold'
              >
                {documents.length}
              </Badge>
            )}
          </button>

          {/* tabs */}
          <nav className='flex items-stretch'>
            <button
              className={cn(
                'flex items-center gap-2 px-4 text-sm font-medium transition-colors border-b-2 -mb-px',
                activeTab === 'chat'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setActiveTab('chat')}
            >
              <MessageSquare className='size-3.5' />
              Chat
            </button>
            <button
              className={cn(
                'flex items-center gap-2 px-4 text-sm font-medium transition-colors border-b-2 -mb-px',
                activeTab === 'extract'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setActiveTab('extract')}
            >
              <Zap className='size-3.5' />
              Extração ArchonAI
            </button>
          </nav>
        </header>

        {activeTab === 'extract' ? extractPanel : chatPanel}
      </main>
    </div>
  );
}
