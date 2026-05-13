
// IMPORTANT: The API URL for your Google Apps Script
export const UNIFIED_DATA_API_URL = 'https://script.google.com/macros/s/AKfycbxiO9AWMlIAsLtUKtAbl1JuLufPRUeQua4lmuRHGFmcaKCEqKHsH1YsZaBQQ5wBShqcDg/exec';

export const CARNE_LEAO_TAX_BRACKETS = [
    { limit: 2259.20, rate: 0, deduction: 0 },
    { limit: 2826.65, rate: 0.075, deduction: 169.44 },
    { limit: 3751.05, rate: 0.15, deduction: 381.44 },
    { limit: 4664.68, rate: 0.225, deduction: 662.77 },
    { limit: Infinity, rate: 0.275, deduction: 896.00 }
];

// Simples Nacional — Anexo III da LC 123/2006 (vigência 01/01/2018)
// Aplicável a receitas de locação de bens móveis e serviços não relacionados ao §5º-C do art.18
export const SIMPLES_NACIONAL_BRACKETS = [
    { limit: 180000.00,   rate: 0.06,   deduction: 0         },
    { limit: 360000.00,   rate: 0.112,  deduction: 9360.00   },
    { limit: 720000.00,   rate: 0.135,  deduction: 17640.00  },
    { limit: 1800000.00,  rate: 0.16,   deduction: 35640.00  },
    { limit: 3600000.00,  rate: 0.21,   deduction: 125640.00 },
    { limit: Infinity,    rate: 0.33,   deduction: 648000.00 },
];

export const CONDOMINIO_201_FIXED = 1888.13;
export const CONDOMINIO_202_FIXED = 952.85;

// Prestador
export const NFSE_CNPJ_PRESTADOR = '64593663000140';
export const NFSE_RAZAO_SOCIAL_PRESTADOR = 'CEBARROS POUSADA LTDA';
export const NFSE_INSCRICAO_MUNICIPAL = '0343331';
export const NFSE_RPS_SERIES_DEFAULT = 'RPS';
export const NFSE_ISS_ALIQUOTA_DEFAULT = 0.0;

// Campos fixos do XML (Grupo A — obrigatórios no arquivo)
export const NFSE_ITEM_LISTA_SERVICO = '09.01';
export const NFSE_ITEM_DESDOBRO_NACIONAL = '09.01.04.000';
export const NFSE_CODIGO_NBS_DISPLAY = '1.0303.12.00';
export const NFSE_CNAE_DISPLAY = 'I.55.1.08.002 - APART-HOTEIS';

// Tomadores fixos por plataforma
export const NFSE_TOMADORES: Record<string, { cnpj: string; razaoSocial: string }> = {
  AIRBNB: {
    cnpj: '36297602000108',
    razaoSocial: 'AIRBNB PLATAFORMA DIGITAL LTDA',
  },
  BOOKING: {
    cnpj: '10625931000139',
    razaoSocial: 'BOOKING.COM BRASIL SERVICOS DE RESERVA DE HOTEIS LTDA',
  },
  DECOLAR: {
    cnpj: '03563689000231',
    razaoSocial: 'DECOLAR.COM LTDA',
  },
};
// Plataformas com tomador fixo — não exibir campo de CPF/CNPJ para estas
export const NFSE_PLATAFORMAS_TOMADOR_FIXO = ['AIRBNB', 'BOOKING', 'DECOLAR'];
