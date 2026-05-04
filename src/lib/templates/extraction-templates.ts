export type ExtractionTemplate = {
  id: string;
  name: string;
  description: string;
  fields: string[];
};

export const acordoExtrajudicialTemplate: ExtractionTemplate = {
  id: "acordo-extrajudicial",
  name: "Acordo Extrajudicial de Reconhecimento de Dívida",
  description: "Extrai dados de acordos extrajudiciais conforme art. 784, III, CPC",
  fields: [
    "Nome/Razão Social do Credor",
    "CNPJ do Credor",
    "Nome do Devedor",
    "CPF do Devedor",
    "Valor total da dívida original",
    "Valor total com desconto",
    "Percentual de desconto concedido",
    "Data de assinatura do acordo",
    "Número das Notas Fiscais relacionadas",
    "Valor da parcela de entrada",
  ],
};

export const contratoHonorariosTemplate: ExtractionTemplate = {
  id: "contrato-honorarios",
  name: "Contrato de Honorários Advocatícios",
  description: "Extrai dados de contratos de honorários entre cliente e escritório de advocacia",
  fields: [
    "Nome/Razão Social do Contratante",
    "CNPJ do Contratante",
    "Nome do Escritório Contratado",
    "Nome do Advogado Responsável",
    "OAB do Advogado Responsável",
    "Valor dos honorários mensais",
    "Percentual de honorários de êxito",
    "Data de início do contrato",
    "Data de término do contrato",
    "Prazo de aviso para rescisão (dias)",
  ],
};

export const procuracaoAdJudiciaTemplate: ExtractionTemplate = {
  id: "procuracao-ad-judicia",
  name: "Procuração Ad Judicia et Extra",
  description: "Extrai dados de procurações judiciais e extrajudiciais",
  fields: [
    "Nome completo do Outorgante",
    "CPF do Outorgante",
    "Nome do Escritório Outorgado",
    "Nomes dos Advogados Outorgados",
    "Números OAB dos Advogados Outorgados",
    "CNPJ do Escritório Outorgado",
    "Data de emissão da procuração",
    "Prazo de validade da procuração",
    "Finalidade/objeto da procuração",
    "Foro eleito",
  ],
};

export const extractionTemplates: ExtractionTemplate[] = [
  acordoExtrajudicialTemplate,
  contratoHonorariosTemplate,
  procuracaoAdJudiciaTemplate,
];
