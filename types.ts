
export enum ReportType {
    Dashboard = 'dashboard',
    ReceptionCleaning = 'receptionCleaning',
    LaundryControl = 'laundryControl',
    Calendar = 'calendar',
    Financial = 'financial',
    ExpenseEntry = 'expenseEntry',
    CarneLeao = 'carneLeao',
    NfseControl = 'nfseControl',
    Compensation = 'compensation',
    InteractiveCompensation = 'interactiveCompensation',
    YearlyFinancialSummary = 'yearlyFinancialSummary',
    FixedCosts = 'fixedCosts',
    DynamicPricing = 'dynamicPricing',
    CashFlow = 'cashFlow',
    YearlyCashFlow = 'yearlyCashFlow',
    CashAccrualCompare = 'cashAccrualCompare',
}

export interface Reservation {
    id: string;
    checkIn: Date;
    checkOut: Date;
    guestName: string;
    flat: string;
    platform: string;
    grossEarnings: number;
    fees: number;
    netEarnings: number;
    confirmationCode?: string;
}

export interface BankDeposit {
    id: string;
    date: Date;
    description: string;
    amount: number;
}

export interface OtherService {
    id: string;
    description: string;
    quantity: number;
    unitValue: number;
}

export interface GeneralService {
    id: string;
    description: string;
    flat: string;
    value: number;
}

export interface LaundryEntry {
    laundryQty: number;
    hasExtraCleaning: boolean;
    extraCleaningQty: number;

    hasExtraLaundry: boolean;
    extraLaundryQty: number;
    
    otherServices?: OtherService[]; // Kept for backward compatibility but deprecated in UI
}

export interface CleaningData {
    laundryEntries: Record<string, LaundryEntry>;
    generalServices?: GeneralService[]; // New field for independent services
    newAdvance: number;
    serviceDeduction: number;
    finalDebt: number;
}

export interface LinenChange {
    date: string; // ISO date string
    status: 'pending' | 'confirmed' | 'declined';
}

export interface ReceptionData {
    linenChanges: Record<string, LinenChange[]>;
}

export interface CustomExpense {
    id: string;
    description: string;
    value: number;
}

export interface FinancialData {
    deductibleExpenses: Record<string, number>;
    otherExpenses: Record<string, number>;
    customExpenses: CustomExpense[];
}

export interface UnifiedData {
    [key: string]: CleaningData | FinancialData | ReceptionData | CompanyConfig | Record<string, NfseRecord> | undefined;
}

export interface MatchedPair {
    reservations: Reservation[];
    deposit: BankDeposit;
    type: '1-to-1' | 'Sum' | 'Pre-defined' | 'Manual';
}

// Defines the structure for data saved to the Google Sheet
export interface ManualConciliation {
    id: string;
    reservationIds: string[];
    depositIds: string[];
    adjustment: number;
}

export interface DismissedAutoMatch {
    id: string;
    reservationIds: string[];
    depositId: string;
}

export interface NfseRecipient {
    document: string; // CPF or CNPJ
    name: string;
    email: string;
    address?: string;
    number?: string;
    neighborhood?: string;
    cityCode?: string; // IBGE code
    state?: string;
    zipCode?: string;
}

export interface NfseRecord {
    id: string;
    loteNumber: number;
    rpsNumber: number;
    rpsSeries: string;
    depositId: string;
    depositDate: string;          // ISO string da data do depósito
    competenceMonth: number;
    competenceYear: number;
    platform: string;
    reservationIds: string[];
    serviceDescription: string;
    guestDataBlock?: string;
    grossValue: number;           // deposit.amount
    issAliquota: number;
    issValue: number;
    tomadorRazaoSocial: string;
    tomadorCnpjCpf?: string;      // CNPJ/CPF do tomador (automático ou manual)
    status: 'pending' | 'authorized' | 'rejected';
    nfseNumber?: string;
    rejectionReason?: string;
}

export interface CompanyConfig {
    cnpj: string;                 // fixo: '64593663000140'
    razaoSocial: string;          // fixo: 'CEBARROS POUSADA LTDA'
    inscricaoMunicipal: string;   // somente números — obrigatório preencher 1 vez
    issAliquota: number;          // alíquota ISS Simples Nacional (variável por faixa)
    rpsSeries: string;            // padrão: 'RPS'
    lastRpsNumber: number;        // último Nº RPS usado — incrementar a cada geração
    lastLoteNumber: number;       // último Nº de lote — incrementar a cada geração
}
