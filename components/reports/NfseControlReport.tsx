import React, { useState, useMemo } from 'react';
import { Reservation, BankDeposit, UnifiedData, ManualConciliation, CompanyConfig, NfseRecord } from '../../types';
import { performAutoReconciliation } from '../../utils/reconciliation';
import { sanitizeForXml, formatCurrency, formatDate, getMonthName } from '../../utils/helpers';
import { saveNfseData } from '../../services/dataService';
import { 
  NFSE_CNPJ_PRESTADOR,
  NFSE_RAZAO_SOCIAL_PRESTADOR,
  NFSE_INSCRICAO_MUNICIPAL,
  NFSE_RPS_SERIES_DEFAULT,
  NFSE_ISS_ALIQUOTA_DEFAULT,
  NFSE_ITEM_LISTA_SERVICO,
  NFSE_ITEM_DESDOBRO_NACIONAL,
  NFSE_CODIGO_NBS_DISPLAY,
  NFSE_CNAE_DISPLAY,
  NFSE_TOMADORES,
  NFSE_PLATAFORMAS_TOMADOR_FIXO,
  SIMPLES_NACIONAL_BRACKETS,
} from '../../constants';

interface Props {
  reservations: Reservation[];
  deposits: BankDeposit[];
  unifiedData: UnifiedData;
  selectedYear: number;
  selectedMonth: number;
  manualAdjustments: Record<string, number>;
  manualConciliations: ManualConciliation[];
  onDataSave: (key: string, data: any) => void;
}

const NfseControlReport: React.FC<Props> = ({
  reservations,
  deposits,
  unifiedData,
  selectedYear,
  selectedMonth,
  manualAdjustments,
  manualConciliations,
  onDataSave,
}) => {
  const [activeTab, setActiveTab] = useState<'config' | 'generate' | 'control'>('generate');
  
  const [dasDetailModal, setDasDetailModal] = useState<{
    open: boolean;
    month: number;
    year: number;
    revenue: number;
    rbt12: number;
    effectiveRate: number;
    taxDue: number;
    vencimento: string;
  } | null>(null);
  
  // Data from UnifiedData
  const [companyConfig, setCompanyConfig] = useState<CompanyConfig>(() => {
    const saved = unifiedData['nfseCompanyConfig'] as Partial<CompanyConfig> | undefined;
    return {
      cnpj: saved?.cnpj ?? NFSE_CNPJ_PRESTADOR,
      razaoSocial: saved?.razaoSocial ?? NFSE_RAZAO_SOCIAL_PRESTADOR,
      inscricaoMunicipal: saved?.inscricaoMunicipal ?? NFSE_INSCRICAO_MUNICIPAL,
      issAliquota: saved?.issAliquota ?? NFSE_ISS_ALIQUOTA_DEFAULT,
      rpsSeries: saved?.rpsSeries ?? NFSE_RPS_SERIES_DEFAULT,
      lastRpsNumber: saved?.lastRpsNumber ?? 0,
    };
  });

  const nfseRecordsObj: Record<string, NfseRecord> = (unifiedData['nfseRecords'] as Record<string, NfseRecord>) || {};
  const nfseRecords = Object.values(nfseRecordsObj);

  // 1. Resultado da conciliação automática
  const { matchedPairs } = useMemo(() =>
    performAutoReconciliation(reservations, deposits, manualAdjustments),
    [reservations, deposits, manualAdjustments]
  );

  // 2. Mapa depositId → Reservation[] (manual tem precedência sobre automático)
  const depositToReservations = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    matchedPairs.forEach(pair => map.set(pair.deposit.id, pair.reservations));
    manualConciliations.forEach(mc => {
      const linked = reservations.filter(r => mc.reservationIds.includes(r.id));
      mc.depositIds.forEach(dId => map.set(dId, linked));
    });
    return map;
  }, [matchedPairs, manualConciliations, reservations]);

  // 3. Depósitos do mês selecionado, enriquecidos com reservas e plataforma
  const depositsOfMonth = useMemo(() => {
    return deposits
      .filter(d =>
        d.date.getUTCFullYear() === selectedYear &&
        (selectedMonth === 0 || d.date.getUTCMonth() + 1 === selectedMonth)
      )
      .map(d => {
        const linkedReservations = depositToReservations.get(d.id) || [];
        const platforms = [...new Set(linkedReservations.map(r => r.platform))];
        const flats = [...new Set(linkedReservations.map(r => r.flat))];
        return {
          deposit: d,
          reservations: linkedReservations,
          platform: platforms.length > 0 ? platforms.join('+') : 'Nao identificado',
          flats,
          isConciliated: linkedReservations.length > 0,
        };
      })
      .sort((a, b) => a.deposit.date.getTime() - b.deposit.date.getTime());
  }, [deposits, depositToReservations, selectedYear, selectedMonth]);

  // Config Tab State
  const [configForm, setConfigForm] = useState<CompanyConfig>(companyConfig);

  const handleConfigSave = async () => {
    if (!/^\d+$/.test(configForm.inscricaoMunicipal)) {
      setAlertMessage({ title: 'Erro de Validação', message: 'Inscrição Municipal deve conter apenas números.', type: 'error' });
      return;
    }
    try {
      await saveNfseData('nfseCompanyConfig', 'nfseCompanyConfig', configForm);
      setCompanyConfig(configForm);
      onDataSave('nfseCompanyConfig', configForm);
      setAlertMessage({ title: 'Sucesso', message: 'Configurações salvas com sucesso!', type: 'success' });
    } catch (error) {
      setAlertMessage({ title: 'Erro', message: 'Erro ao salvar configurações.', type: 'error' });
    }
  };

  // Generate Tab State
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedFlats, setSelectedFlats] = useState<string[]>([]);
  const [selectedDepositIds, setSelectedDepositIds] = useState<Set<string>>(new Set());
  const [recipientData, setRecipientData] = useState<Record<string, string>>({}); // depositId -> cpfCnpj
  const [fichasModalOpen, setFichasModalOpen] = useState(false);
  const [currentFichas, setCurrentFichas] = useState<NfseRecord[]>([]);
  const [currentFichaIndex, setCurrentFichaIndex] = useState(0);

  // Control Tab State
  const [actionState, setActionState] = useState<{ id: string, type: 'authorize' | 'reject' } | null>(null);
  const [actionInput, setActionInput] = useState('');
  const [deleteConfirmState, setDeleteConfirmState] = useState<string | null>(null);
  
  // Manual Note Modal State
  const [manualNoteModalOpen, setManualNoteModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<NfseRecord | null>(null);
  const [noteForm, setNoteForm] = useState<Partial<NfseRecord>>({});

  // Alert Modal State
  const [alertMessage, setAlertMessage] = useState<{ title: string, message: string, type: 'success' | 'error' | 'warning' } | null>(null);

  const availablePlatforms = useMemo(() => {
    const platforms = new Set<string>();
    depositsOfMonth.forEach(d => platforms.add(d.platform));
    return Array.from(platforms);
  }, [depositsOfMonth]);

  const filteredDeposits = useMemo(() => {
    return depositsOfMonth.filter(d => {
      const platformMatch = selectedPlatforms.length === 0 || selectedPlatforms.includes(d.platform);
      const flatMatch = selectedFlats.length === 0 || d.flats.some(f => selectedFlats.includes(f));
      return platformMatch && flatMatch;
    });
  }, [depositsOfMonth, selectedPlatforms, selectedFlats]);

  const handleSelectAll = () => {
    const newSelected = new Set(filteredDeposits.map(d => d.deposit.id));
    setSelectedDepositIds(newSelected);
  };

  const handleClearSelection = () => {
    setSelectedDepositIds(new Set());
  };

  const toggleDepositSelection = (id: string) => {
    const newSelected = new Set(selectedDepositIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedDepositIds(newSelected);
  };

  const generateServiceDescription = (d: typeof depositsOfMonth[0]) => {
    if (!d.isConciliated) {
      return `Hospedagem - ${sanitizeForXml(d.deposit.description)} - ${formatDate(d.deposit.date)}`;
    }

    if (d.reservations.length === 1) {
      const r = d.reservations[0];
      return `Hospedagem - Flat ${r.flat} - ${r.guestName} - ${d.platform}`;
    }

    const flatsStr = d.flats.join(', ');
    const periodStr = `${String(d.deposit.date.getUTCMonth() + 1).padStart(2, '0')}/${d.deposit.date.getUTCFullYear()}`;
    let desc = `Hospedagem ${d.platform} - ${d.reservations.length} reservas - ${periodStr} - Flats: ${flatsStr}\n`;
    
    const hospList = d.reservations.map(r => r.guestName).join('; ');
    desc += hospList;

    if (desc.length > 2000) {
      desc = desc.substring(0, 1996) + '...';
    }
    return desc;
  };

  const generateGuestDataBlock = (d: typeof depositsOfMonth[0]) => {
    if (!d.isConciliated || d.reservations.length === 0) {
      return `${d.deposit.description}   R$${d.deposit.amount.toFixed(2).replace('.', ',')} BRL\n${formatDate(d.deposit.date)}`;
    }

    return d.reservations.map(r => {
      let block = `${r.guestName}   R$${r.netEarnings.toFixed(2).replace('.', ',')} BRL\nDi Maré.${r.flat}. Porto de Galinhas`;
      if (r.confirmationCode) {
        block += `\n${r.confirmationCode}`;
      }
      return block;
    }).join('\n\n');
  };

  const handlePrepareFichas = () => {
    if (!companyConfig.inscricaoMunicipal) {
      setAlertMessage({ title: 'Atenção', message: 'Preencha a Inscrição Municipal na aba Configuração antes de preparar as fichas.', type: 'warning' });
      setActiveTab('config');
      return;
    }

    if (selectedDepositIds.size === 0) {
      setAlertMessage({ title: 'Atenção', message: 'Selecione ao menos um depósito para preparar as fichas.', type: 'warning' });
      return;
    }

    const selectedDepositsData = filteredDeposits.filter(d => selectedDepositIds.has(d.deposit.id));
    
    let currentRps = companyConfig.lastRpsNumber;

    const newRecords: Record<string, NfseRecord> = { ...nfseRecordsObj };
    const generatedFichas: NfseRecord[] = [];

    selectedDepositsData.forEach(d => {
      currentRps++;
      const description = generateServiceDescription(d);
      const guestDataBlock = generateGuestDataBlock(d);
      
      let tomadorRazaoSocial = 'CONSUMIDOR FINAL';
      let tomadorCnpjCpf = recipientData[d.deposit.id]?.replace(/\D/g, '');

      if (NFSE_TOMADORES[d.platform]) {
        tomadorRazaoSocial = NFSE_TOMADORES[d.platform].razaoSocial;
        tomadorCnpjCpf = NFSE_TOMADORES[d.platform].cnpj;
      }
      
      const issValue = d.deposit.amount * (companyConfig.issAliquota / 100);
      
      // Create Record
      const recordId = `nfse_${Date.now()}_${currentRps}`;
      const newRecord: NfseRecord = {
        id: recordId,
        loteNumber: 0, // Not used in manual emission
        rpsNumber: currentRps,
        rpsSeries: companyConfig.rpsSeries,
        depositId: d.deposit.id,
        depositDate: d.deposit.date.toISOString(),
        competenceMonth: d.deposit.date.getUTCMonth() + 1,
        competenceYear: d.deposit.date.getUTCFullYear(),
        platform: d.platform,
        reservationIds: d.reservations.map(r => r.id),
        serviceDescription: description,
        guestDataBlock,
        grossValue: d.deposit.amount,
        issAliquota: companyConfig.issAliquota,
        issValue,
        status: 'authorized',
        tomadorRazaoSocial,
        tomadorCnpjCpf
      };
      
      newRecords[recordId] = newRecord;
      generatedFichas.push(newRecord);
    });

    // Save state
    const updatedConfig = { ...configForm, lastRpsNumber: currentRps };
    
    Promise.all([
      saveNfseData('nfseCompanyConfig', 'nfseCompanyConfig', updatedConfig),
      saveNfseData('nfseRecords', 'nfseRecords', newRecords)
    ]).then(() => {
      onDataSave('nfseCompanyConfig', updatedConfig);
      setCompanyConfig(updatedConfig);
      setConfigForm(updatedConfig);
      onDataSave('nfseRecords', newRecords);
      
      setCurrentFichas(generatedFichas);
      setCurrentFichaIndex(0);
      setFichasModalOpen(true);
      setAlertMessage({ title: 'Sucesso', message: 'Notas geradas e registradas como autorizadas.', type: 'success' });
    }).catch(() => {
      setAlertMessage({ title: 'Erro', message: 'Erro ao salvar as fichas geradas.', type: 'error' });
    });
  };

  // Control Tab State
  const recordsOfMonth = nfseRecords.filter(r => r.competenceYear === selectedYear && (selectedMonth === 0 || r.competenceMonth === selectedMonth));
  const totalIssued = recordsOfMonth.length;
  const totalAuthorized = recordsOfMonth.filter(r => r.status === 'authorized').length;
  const issAuthorized = recordsOfMonth.filter(r => r.status === 'authorized').reduce((acc, r) => acc + r.issValue, 0);
  
  const hasDepositsWithoutNfse = depositsOfMonth.some(d => !recordsOfMonth.some(r => r.depositId === d.deposit.id));

  const updateRecordStatus = (id: string, status: 'authorized' | 'rejected', nfseNumber?: string, rejectionReason?: string) => {
    const newRecords = { ...nfseRecordsObj };
    if (newRecords[id]) {
      newRecords[id] = { ...newRecords[id], status, nfseNumber, rejectionReason };
      saveNfseData('nfseRecords', 'nfseRecords', newRecords).then(() => {
        onDataSave('nfseRecords', newRecords);
      }).catch(() => {
        setAlertMessage({ title: 'Erro', message: 'Erro ao atualizar o status da nota.', type: 'error' });
      });
    }
  };

  // Annual Summary
  const annualSummary = useMemo(() => {
    const summary = [];
  
    // Helper: soma grossValue das NFS-e de qualquer mês/ano
    const getNfseRevenue = (y: number, m: number): number =>
      Object.values((unifiedData['nfseRecords'] as Record<string, NfseRecord>) || {})
        .filter(r => r.competenceYear === y && r.competenceMonth === m)
        .reduce((sum, r) => sum + (r.grossValue || 0), 0);
  
    for (let month = 1; month <= 12; month++) {
      const monthDeposits = deposits.filter(d => d.date.getUTCFullYear() === selectedYear && d.date.getUTCMonth() + 1 === month);
      const monthRecords = nfseRecords.filter(r => r.competenceYear === selectedYear && r.competenceMonth === month);
  
      // Cálculo do DAS Simples Nacional (apenas para 2026 em diante)
      let dasValue = 0;
      let dasRbt12 = 0;
      let dasEffectiveRate = 0;
      if (selectedYear >= 2026) {
        const monthlyRevenue = getNfseRevenue(selectedYear, month);
        // RBT12: soma dos últimos 12 meses de NFS-e (incluindo o mês atual)
        let rbt12 = 0;
        for (let i = 0; i < 12; i++) {
          let y = selectedYear;
          let m = month - i;
          if (m <= 0) { m += 12; y -= 1; }
          rbt12 += getNfseRevenue(y, m);
        }
        const bracket = SIMPLES_NACIONAL_BRACKETS.find(b => rbt12 <= b.limit);
        if (bracket && rbt12 > 0 && monthlyRevenue > 0) {
          dasEffectiveRate = Math.max(0, ((rbt12 * bracket.rate) - bracket.deduction) / rbt12);
          dasValue = monthlyRevenue * dasEffectiveRate;
        }
        dasRbt12 = rbt12;
      }
  
      // Vencimento: dia 20 do mês seguinte
      const vencMes = month === 12 ? 1 : month + 1;
      const vencAno = month === 12 ? selectedYear + 1 : selectedYear;
      const vencimento = `20/${String(vencMes).padStart(2, '0')}/${vencAno}`;
  
      summary.push({
        month,
        depositsCount: monthDeposits.length,
        recordsCount: monthRecords.length,
        totalValue: monthRecords.reduce((acc, r) => acc + r.grossValue, 0),
        totalIss: monthRecords.reduce((acc, r) => acc + r.issValue, 0),
        authorizedCount: monthRecords.filter(r => r.status === 'authorized').length,
        pendingCount: monthRecords.filter(r => r.status === 'pending').length,
        dasValue,
        dasRbt12,
        dasEffectiveRate,
        vencimento,
      });
    }
    return summary;
  }, [deposits, nfseRecords, selectedYear, unifiedData]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">NFS-e (PJ)</h2>
        <div className="flex space-x-2">
          <button
            onClick={() => setActiveTab('config')}
            className={`px-4 py-2 rounded-md text-sm font-medium ${activeTab === 'config' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'}`}
          >
            Configuração
          </button>
          <button
            onClick={() => setActiveTab('generate')}
            className={`px-4 py-2 rounded-md text-sm font-medium ${activeTab === 'generate' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'}`}
          >
            Emitir Nota
          </button>
          <button
            onClick={() => setActiveTab('control')}
            className={`px-4 py-2 rounded-md text-sm font-medium ${activeTab === 'control' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'}`}
          >
            Controle de Notas
          </button>
        </div>
      </div>

      {activeTab === 'config' && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Configuração da Empresa</h3>
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
            <div className="flex">
              <div className="flex-shrink-0">
                <span className="text-yellow-400">⚠️</span>
              </div>
              <div className="ml-3">
                <p className="text-sm text-yellow-700 font-medium">
                  Os campos fiscais (CNAE, Item de Serviço, Código NBS) já estão configurados com os valores confirmados pelo portal de Ipojuca para hospedagem em apart-hotel. Não altere sem orientação do contador.
                </p>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CNPJ</label>
              <input
                type="text"
                value={configForm.cnpj}
                readOnly
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Razão Social</label>
              <input
                type="text"
                value={configForm.razaoSocial}
                readOnly
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Inscrição Municipal</label>
              <input
                type="text"
                value={configForm.inscricaoMunicipal}
                readOnly
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Alíquota ISS (%)</label>
              <input
                type="number"
                step="0.01"
                value={configForm.issAliquota}
                onChange={e => {
                  const val = parseFloat(e.target.value);
                  setConfigForm({...configForm, issAliquota: isNaN(val) ? 0 : val});
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <p className="mt-1 text-xs text-gray-500">Alíquota do Simples Nacional varia conforme faixa de receita. Confirme com seu contador.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Série RPS</label>
              <input
                type="text"
                value={configForm.rpsSeries}
                onChange={e => setConfigForm({...configForm, rpsSeries: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Último Número RPS Emitido</label>
              <input
                type="number"
                value={configForm.lastRpsNumber}
                onChange={e => setConfigForm({...configForm, lastRpsNumber: parseInt(e.target.value, 10) || 0})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleConfigSave}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Salvar Configurações
            </button>
          </div>
        </div>
      )}

      {activeTab === 'generate' && (
        <div className="space-y-6">
          <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-md">
            <div className="flex">
              <div className="flex-shrink-0">
                <span className="text-blue-400">ℹ️</span>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-blue-800">Emissão manual pelo portal</h3>
                <div className="mt-2 text-sm text-blue-700">
                  <p>Selecione os depósitos e clique em "Preparar Ficha de Emissão".</p>
                  <p>O sistema exibirá os dados de cada nota campo a campo, prontos para copiar no portal.</p>
                  <p className="mt-2">
                    <strong>Portal:</strong> NFS-e Nacional (A partir de 01/01/2026) → Geração
                  </p>
                </div>
              </div>
            </div>
          </div>

          {!companyConfig.inscricaoMunicipal && (
            <div className="bg-red-50 border-l-4 border-red-400 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <span className="text-red-400">⚠️</span>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-red-700 font-medium">
                    Preencha a Inscrição Municipal na aba Configuração antes de preparar as fichas.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-wrap gap-6 items-center">
            <div>
              <span className="text-sm font-medium text-gray-500 block mb-1">Período</span>
              <span className="text-gray-900 font-medium">
                {selectedMonth === 0 ? `Ano ${selectedYear}` : `${getMonthName(selectedMonth)} ${selectedYear}`}
              </span>
              <p className="text-xs text-gray-400 mt-1">Use o seletor de mês/ano no topo da página para mudar o período.</p>
            </div>
            
            <div>
              <span className="text-sm font-medium text-gray-500 block mb-1">Plataformas</span>
              <div className="flex flex-wrap gap-2">
                {availablePlatforms.map(p => (
                  <label key={p} className="inline-flex items-center">
                    <input
                      type="checkbox"
                      checked={selectedPlatforms.includes(p)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedPlatforms([...selectedPlatforms, p]);
                        else setSelectedPlatforms(selectedPlatforms.filter(x => x !== p));
                      }}
                      className="h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                    />
                    <span className="ml-2 text-sm text-gray-700">{p}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <span className="text-sm font-medium text-gray-500 block mb-1">Flats</span>
              <div className="flex gap-2">
                {['201', '202', '301'].map(f => (
                  <label key={f} className="inline-flex items-center">
                    <input
                      type="checkbox"
                      checked={selectedFlats.includes(f)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedFlats([...selectedFlats, f]);
                        else setSelectedFlats(selectedFlats.filter(x => x !== f));
                      }}
                      className="h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                    />
                    <span className="ml-2 text-sm text-gray-700">{f}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-800">Depósitos do Mês</h3>
              <div className="space-x-2">
                <button onClick={handleSelectAll} className="px-3 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-700">
                  Selecionar Todos
                </button>
                <button onClick={handleClearSelection} className="px-3 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-700">
                  Limpar Seleção
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-10"></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data Depósito</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plataforma</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Flat(s)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Hóspede(s)</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Valor (R$)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tomador</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">CPF/CNPJ Tomador</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredDeposits.map((d) => {
                    const isFixedTomador = NFSE_PLATAFORMAS_TOMADOR_FIXO.includes(d.platform);
                    const fixedTomadorData = isFixedTomador ? NFSE_TOMADORES[d.platform] : null;
                    
                    return (
                    <tr key={d.deposit.id} className={`${!d.isConciliated ? 'bg-yellow-50' : ''} hover:bg-gray-50`}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={selectedDepositIds.has(d.deposit.id)}
                          onChange={() => toggleDepositSelection(d.deposit.id)}
                          className="h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {formatDate(d.deposit.date)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {d.platform}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {d.flats.join(', ')}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 max-w-xs truncate" title={d.reservations.map(r => r.guestName).join(' + ')}>
                        {!d.isConciliated ? (
                          <span className="text-yellow-600 flex items-center">
                            <span className="mr-1">⚠️</span>
                            Sem reserva vinculada
                          </span>
                        ) : (
                          d.reservations.map(r => r.guestName).join(' + ')
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                        {formatCurrency(d.deposit.amount)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {isFixedTomador ? (
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${d.platform === 'AIRBNB' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>
                            {fixedTomadorData?.razaoSocial}
                          </span>
                        ) : (
                          <span className="text-gray-500">CONSUMIDOR FINAL</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {isFixedTomador ? (
                          <span className="text-gray-400">{fixedTomadorData?.cnpj}</span>
                        ) : (
                          <input
                            type="text"
                            placeholder="Deixar vazio = Consumidor Final"
                            value={recipientData[d.deposit.id] || ''}
                            onChange={(e) => setRecipientData({...recipientData, [d.deposit.id]: e.target.value})}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        )}
                      </td>
                    </tr>
                  )})}
                  {filteredDeposits.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                        Nenhum depósito encontrado para os filtros selecionados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="bg-gray-50 p-4 border-t border-gray-200 flex justify-between items-center">
              <div className="text-sm text-gray-600">
                <span className="font-medium text-gray-900">{selectedDepositIds.size}</span> depósitos selecionados
                <span className="mx-2">|</span>
                Total: <span className="font-medium text-gray-900">{formatCurrency(filteredDeposits.filter(d => selectedDepositIds.has(d.deposit.id)).reduce((acc, d) => acc + d.deposit.amount, 0))}</span>
                <span className="mx-2">|</span>
                ISS estimado ({companyConfig?.issAliquota || 0}%): <span className="font-medium text-gray-900">{formatCurrency(filteredDeposits.filter(d => selectedDepositIds.has(d.deposit.id)).reduce((acc, d) => acc + d.deposit.amount * ((companyConfig?.issAliquota || 0) / 100), 0))}</span>
                
                {filteredDeposits.filter(d => selectedDepositIds.has(d.deposit.id) && !d.isConciliated).length > 0 && (
                  <p className="text-yellow-600 mt-1">
                    ⚠️ {filteredDeposits.filter(d => selectedDepositIds.has(d.deposit.id) && !d.isConciliated).length} depósito(s) sem reserva vinculada serão incluídos com descrição genérica.
                  </p>
                )}
              </div>
              <button
                onClick={handlePrepareFichas}
                className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                📋 Preparar Ficha de Emissão
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'control' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
              <p className="text-sm font-medium text-gray-500">🟢 Autorizadas</p>
              <p className="text-2xl font-bold text-green-600">{totalAuthorized} <span className="text-sm font-normal text-gray-500">({formatCurrency(issAuthorized)})</span></p>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
              <p className="text-sm font-medium text-gray-500">🔴 Rejeitadas</p>
              <p className="text-2xl font-bold text-red-600">{recordsOfMonth.filter(r => r.status === 'rejected').length}</p>
            </div>
            <div className={`bg-white p-4 rounded-xl shadow-sm border ${hasDepositsWithoutNfse ? 'border-red-300 bg-red-50' : 'border-gray-100'}`}>
              <p className="text-sm font-medium text-gray-500">⚠️ Depósitos sem NFS-e</p>
              <p className={`text-2xl font-bold ${hasDepositsWithoutNfse ? 'text-red-600' : 'text-gray-900'}`}>
                {depositsOfMonth.filter(d => !recordsOfMonth.some(r => r.depositId === d.deposit.id)).length}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-800">NFS-e Registradas no Mês</h3>
              <button
                onClick={() => {
                  setNoteForm({
                    id: `nfse_manual_${Date.now()}`,
                    rpsNumber: companyConfig.lastRpsNumber + 1,
                    depositDate: new Date(selectedYear, selectedMonth === 0 ? 0 : selectedMonth - 1, 1).toISOString(),
                    competenceMonth: selectedMonth === 0 ? 1 : selectedMonth,
                    competenceYear: selectedYear,
                    platform: 'Outros',
                    tomadorRazaoSocial: 'CONSUMIDOR FINAL',
                    grossValue: 0,
                    issValue: 0,
                    status: 'authorized',
                    nfseNumber: '',
                    rpsSeries: companyConfig.rpsSeries,
                  });
                  setEditingNote(null);
                  setManualNoteModalOpen(true);
                }}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700"
              >
                + Adicionar Nota Manual
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">RPS</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plataforma</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tomador</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Valor</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">ISS</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nº NFS-e</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Editar / Apagar</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {recordsOfMonth.sort((a, b) => a.rpsNumber - b.rpsNumber).map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-medium">
                        {r.rpsNumber}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(new Date(r.depositDate))}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {r.platform}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 max-w-[150px] truncate" title={r.tomadorRazaoSocial}>
                        {r.tomadorRazaoSocial}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                        {formatCurrency(r.grossValue)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 text-right">
                        {formatCurrency(r.issValue)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                          ${r.status === 'authorized' ? 'bg-green-100 text-green-800' : 
                            r.status === 'rejected' ? 'bg-red-100 text-red-800' : 
                            'bg-yellow-100 text-yellow-800'}`}>
                          {r.status === 'authorized' ? 'Autorizada' : r.status === 'rejected' ? 'Rejeitada' : 'Pendente'}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {r.status === 'authorized' ? <span className="text-green-600 font-medium">{r.nfseNumber || '-'}</span> : '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {(r.status === 'pending' || r.status === 'authorized') && (
                          <div className="flex space-x-2">
                            {actionState?.id === r.id ? (
                              <div className="flex items-center space-x-2">
                                <input
                                  type="text"
                                  placeholder={actionState.type === 'authorize' ? 'Nº da NFS-e' : 'Motivo'}
                                  value={actionInput}
                                  onChange={(e) => setActionInput(e.target.value)}
                                  className="px-2 py-1 text-sm border border-gray-300 rounded focus:ring-indigo-500 focus:border-indigo-500 w-32"
                                />
                                <button
                                  onClick={() => {
                                    if (actionState.type === 'authorize' || actionInput.trim()) {
                                      if (actionState.type === 'authorize') {
                                        updateRecordStatus(r.id, 'authorized', actionInput.trim() || undefined);
                                      } else {
                                        updateRecordStatus(r.id, 'rejected', undefined, actionInput.trim());
                                      }
                                      setActionState(null);
                                      setActionInput('');
                                    }
                                  }}
                                  className="px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-xs"
                                >
                                  Salvar
                                </button>
                                <button
                                  onClick={() => {
                                    setActionState(null);
                                    setActionInput('');
                                  }}
                                  className="px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-xs"
                                >
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <>
                                <button 
                                  onClick={() => {
                                    setActionState({ id: r.id, type: 'authorize' });
                                    setActionInput(r.nfseNumber || '');
                                  }}
                                  className="px-2 py-1 bg-green-50 text-green-600 border border-green-200 rounded hover:bg-green-100" title={r.status === 'authorized' ? "Registrar/Atualizar Nº NFS-e" : "Marcar como Autorizada"}
                                >
                                  {r.status === 'authorized' ? '📝 Nº NFS-e' : '✅ Autorizada'}
                                </button>
                                <button 
                                  onClick={() => {
                                    setActionState({ id: r.id, type: 'reject' });
                                    setActionInput('');
                                  }}
                                  className="px-2 py-1 bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100" title="Marcar como Rejeitada"
                                >
                                  ❌ Rejeitada
                                </button>
                              </>
                            )}
                          </div>
                        )}
                        {r.status === 'rejected' && (
                          <span className="text-red-500 text-xs" title={r.rejectionReason}>{r.rejectionReason?.substring(0, 20)}...</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center">
                        {deleteConfirmState === r.id ? (
                          <div className="flex flex-col items-center space-y-1">
                            <span className="text-xs text-red-600 font-medium">Apagar esta nota?</span>
                            <div className="flex space-x-2">
                              <button
                                onClick={() => {
                                  const newRecords = { ...nfseRecordsObj };
                                  delete newRecords[r.id];
                                  saveNfseData('nfseRecords', 'nfseRecords', newRecords).then(() => {
                                    onDataSave('nfseRecords', newRecords);
                                    setDeleteConfirmState(null);
                                  }).catch(() => {
                                    setAlertMessage({ title: 'Erro', message: 'Erro ao apagar a nota.', type: 'error' });
                                  });
                                }}
                                className="px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-xs"
                              >
                                Sim, apagar
                              </button>
                              <button
                                onClick={() => setDeleteConfirmState(null)}
                                className="px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-xs"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex justify-center items-center space-x-2">
                            <button
                              onClick={() => {
                                setNoteForm({ ...r });
                                setEditingNote(r);
                                setManualNoteModalOpen(true);
                              }}
                              className="text-blue-400 hover:text-blue-600 p-1 rounded hover:bg-blue-50"
                              title="Editar Nota"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => setDeleteConfirmState(r.id)}
                              className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50"
                              title="Apagar Nota"
                            >
                              🗑️
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {recordsOfMonth.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                        Nenhuma NFS-e registrada neste mês.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Annual Summary */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mt-8">
            <div className="p-4 border-b border-gray-100 bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-800">Resumo Anual ({selectedYear})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mês</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Depósitos</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">NFS-e Emitidas</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Valor Total</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">ISS</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Autorizadas</th>
                    {selectedYear >= 2026 && (
                      <th className="px-4 py-3 text-right text-xs font-medium text-indigo-600 uppercase tracking-wider">
                        DAS Simples Nacional
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {annualSummary.map((s) => (
                    <tr key={s.month} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {getMonthName(s.month)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-center text-gray-500">
                        {s.depositsCount || '—'}
                      </td>
                      <td className={`px-4 py-3 whitespace-nowrap text-sm text-center font-medium ${s.depositsCount > s.recordsCount ? 'text-orange-600' : 'text-gray-900'}`}>
                        {s.recordsCount || '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                        {s.totalValue ? formatCurrency(s.totalValue) : '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-500">
                        {s.totalIss ? formatCurrency(s.totalIss) : '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-center text-green-600">
                        {s.authorizedCount || '—'}
                      </td>
                      {selectedYear >= 2026 && (
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right">
                          {s.dasValue > 0 ? (
                            <div className="flex items-center justify-end gap-2">
                              <span className="font-semibold text-indigo-700">
                                {formatCurrency(s.dasValue)}
                              </span>
                              <button
                                onClick={() => setDasDetailModal({
                                  open: true,
                                  month: s.month,
                                  year: selectedYear,
                                  revenue: s.totalValue,
                                  rbt12: s.dasRbt12,
                                  effectiveRate: s.dasEffectiveRate,
                                  taxDue: s.dasValue,
                                  vencimento: s.vencimento,
                                })}
                                className="text-xs px-2 py-1 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200 whitespace-nowrap"
                              >
                                Ver detalhes
                              </button>
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-bold">
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">Total Ano</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-center text-gray-900">
                      {annualSummary.reduce((acc, s) => acc + s.depositsCount, 0)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-center text-gray-900">
                      {annualSummary.reduce((acc, s) => acc + s.recordsCount, 0)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                      {formatCurrency(annualSummary.reduce((acc, s) => acc + s.totalValue, 0))}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                      {formatCurrency(annualSummary.reduce((acc, s) => acc + s.totalIss, 0))}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-center text-green-600">
                      {annualSummary.reduce((acc, s) => acc + s.authorizedCount, 0)}
                    </td>
                    {selectedYear >= 2026 && (
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-bold text-indigo-700">
                        {formatCurrency(annualSummary.reduce((acc, s) => acc + s.dasValue, 0))}
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalhe do DAS Simples Nacional */}
      {dasDetailModal?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" aria-modal="true">
          <div
            className="fixed inset-0 bg-gray-500 bg-opacity-75"
            onClick={() => setDasDetailModal(null)}
          />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6 z-10">
            
            {/* Cabeçalho */}
            <div className="flex justify-between items-start mb-5">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  DAS — Simples Nacional
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Competência: {getMonthName(dasDetailModal.month)}/{dasDetailModal.year}
                </p>
              </div>
              <button
                onClick={() => setDasDetailModal(null)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold leading-none"
              >
                ×
              </button>
            </div>

            {/* Tabela de cálculo */}
            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-600">Receita do mês (NFS-e emitidas)</span>
                <span className="font-medium text-gray-900">{formatCurrency(dasDetailModal.revenue)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-600">RBT12 (receita acumulada 12 meses)</span>
                <span className="font-medium text-gray-900">{formatCurrency(dasDetailModal.rbt12)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-600">Faixa do Simples Nacional</span>
                <span className="font-medium text-gray-900">
                  {dasDetailModal.rbt12 <= 180000 ? '1ª Faixa (até R$ 180 mil)' :
                   dasDetailModal.rbt12 <= 360000 ? '2ª Faixa (até R$ 360 mil)' :
                   dasDetailModal.rbt12 <= 720000 ? '3ª Faixa (até R$ 720 mil)' :
                   dasDetailModal.rbt12 <= 1800000 ? '4ª Faixa (até R$ 1,8 mi)' :
                   dasDetailModal.rbt12 <= 3600000 ? '5ª Faixa (até R$ 3,6 mi)' :
                   '6ª Faixa (até R$ 4,8 mi)'}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-600">Alíquota efetiva</span>
                <span className="font-medium text-gray-900">
                  {(dasDetailModal.effectiveRate * 100).toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-600 text-xs italic">
                  Fórmula: {formatCurrency(dasDetailModal.revenue)} × {(dasDetailModal.effectiveRate * 100).toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between py-3 bg-indigo-50 rounded-lg px-3 mt-2">
                <span className="font-bold text-indigo-800">DAS a recolher</span>
                <span className="font-bold text-indigo-800 text-base">
                  {formatCurrency(dasDetailModal.taxDue)}
                </span>
              </div>
              <div className="flex justify-between py-2 mt-1">
                <span className="text-gray-600">📅 Vencimento</span>
                <span className="font-semibold text-orange-600">{dasDetailModal.vencimento}</span>
              </div>
            </div>

            {/* Nota de rodapé */}
            <p className="mt-4 text-xs text-gray-400 leading-relaxed">
              Cálculo baseado no Anexo III da LC 123/2006. A alíquota efetiva é calculada sobre
              a RBT12 (Receita Bruta dos últimos 12 meses). Confirme com seu contador antes do recolhimento.
            </p>

            <button
              onClick={() => setDasDetailModal(null)}
              className="mt-5 w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* Fichas Modal */}
      {fichasModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setFichasModalOpen(false)}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                        Fichas de Preenchimento
                      </h3>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 bg-gray-100 rounded-md p-1">
                          <button
                            onClick={() => setCurrentFichaIndex(Math.max(0, currentFichaIndex - 1))}
                            disabled={currentFichaIndex === 0}
                            className="p-1 rounded hover:bg-white disabled:opacity-50 disabled:hover:bg-transparent"
                            title="Nota Anterior"
                          >
                            ◀
                          </button>
                          <span className="text-sm font-medium px-2">
                            Nota {currentFichaIndex + 1} de {currentFichas.length}
                          </span>
                          <button
                            onClick={() => setCurrentFichaIndex(Math.min(currentFichas.length - 1, currentFichaIndex + 1))}
                            disabled={currentFichaIndex === currentFichas.length - 1}
                            className="p-1 rounded hover:bg-white disabled:opacity-50 disabled:hover:bg-transparent"
                            title="Próxima Nota"
                          >
                            ▶
                          </button>
                        </div>
                        <button
                          onClick={() => window.open('https://www.tinus.com.br/csp/IPOJUCA/portal/', '_blank')}
                          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
                        >
                          ↗️ Abrir Portal Tinus
                        </button>
                      </div>
                    </div>
                    
                    <div className="space-y-8 max-h-[70vh] overflow-y-auto pr-2">
                      {currentFichas.length > 0 && (
                        <div key={currentFichas[currentFichaIndex].id} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                          <div className="flex justify-between items-center mb-4 border-b border-gray-200 pb-2">
                            <h4 className="text-md font-bold text-gray-800">
                              NOTA {currentFichaIndex + 1} de {currentFichas.length} &bull; RPS {currentFichas[currentFichaIndex].rpsNumber} &bull; {currentFichas[currentFichaIndex].platform} &bull; {formatDate(new Date(currentFichas[currentFichaIndex].depositDate))}
                            </h4>
                            <span className="text-sm font-medium">
                              Status: {currentFichas[currentFichaIndex].status === 'pending' ? '🟡 Pendente' : currentFichas[currentFichaIndex].status === 'authorized' ? '✅ Autorizada' : '❌ Rejeitada'}
                            </span>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="text-gray-500 mb-1">Tomador (CPF/CNPJ)</p>
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-gray-900">{currentFichas[currentFichaIndex].tomadorCnpjCpf || 'Consumidor Final (Deixar em branco)'}</p>
                                {currentFichas[currentFichaIndex].tomadorCnpjCpf && (
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(currentFichas[currentFichaIndex].tomadorCnpjCpf!);
                                      setAlertMessage({ title: 'Copiado', message: 'CPF/CNPJ copiado!', type: 'success' });
                                    }}
                                    className="text-indigo-600 hover:text-indigo-800"
                                    title="Copiar CPF/CNPJ"
                                  >
                                    📋
                                  </button>
                                )}
                              </div>
                            </div>
                            <div>
                              <p className="text-gray-500 mb-1">Razão Social / Nome</p>
                              <p className="font-medium text-gray-900">{currentFichas[currentFichaIndex].tomadorRazaoSocial}</p>
                            </div>
                            <div>
                              <p className="text-gray-500 mb-1">Imposto Retido?</p>
                              <p className="font-medium text-gray-900">Não</p>
                            </div>
                            <div>
                              <p className="text-gray-500 mb-1">Atividade - CNAE</p>
                              <p className="font-medium text-gray-900 bg-gray-100 px-2 py-1 rounded inline-block">{NFSE_CNAE_DISPLAY}</p>
                            </div>
                            <div>
                              <p className="text-gray-500 mb-1">Item da Lista de Serviços</p>
                              <p className="font-medium text-gray-900 bg-gray-100 px-2 py-1 rounded inline-block">{NFSE_ITEM_LISTA_SERVICO} - HOSPEDAGEM DE QUALQUER NATUREZA EM HOTÉIS, APART-SERVICE CONDOMINIAIS, FLAT...</p>
                            </div>
                            <div>
                              <p className="text-gray-500 mb-1">Item Desdobro Nacional</p>
                              <p className="font-medium text-gray-900 bg-gray-100 px-2 py-1 rounded inline-block">{NFSE_ITEM_DESDOBRO_NACIONAL} - HOSPEDAGEM EM APART-SERVICE CONDOMINIAIS, FLAT, APART-HOTÉIS, HOTÉIS RESIDÊNCIA...</p>
                            </div>
                            <div>
                              <p className="text-gray-500 mb-1">Código NBS</p>
                              <p className="font-medium text-gray-900 bg-gray-100 px-2 py-1 rounded inline-block">{NFSE_CODIGO_NBS_DISPLAY} - SERVIÇOS DE HOSPEDAGEM EM QUARTOS OU UNIDADES DE HOSPEDAGEM PARA VISITANTES...</p>
                            </div>
                            <div>
                              <p className="text-gray-500 mb-1">Local da Prestação / Município de Incidência</p>
                              <p className="font-medium text-gray-900 bg-gray-100 px-2 py-1 rounded inline-block">PE - IPOJUCA</p>
                            </div>
                          </div>

                          <div className="mt-6 border-t border-gray-200 pt-4">
                            <h5 className="text-md font-medium text-gray-800 mb-3">Descrição dos Serviços</h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                              <div>
                                <p className="text-gray-500 mb-1 text-sm">Valor Total do Serviço</p>
                                <div className="flex items-center gap-2">
                                  <p className="font-medium text-gray-900 text-lg">{currentFichas[currentFichaIndex].grossValue.toFixed(2).replace('.', ',')}</p>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(currentFichas[currentFichaIndex].grossValue.toFixed(2).replace('.', ','));
                                      setAlertMessage({ title: 'Copiado', message: 'Valor copiado!', type: 'success' });
                                    }}
                                    className="px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-xs font-medium"
                                  >
                                    📋 Copiar
                                  </button>
                                </div>
                              </div>
                            </div>
                            <p className="text-gray-500 mb-1 text-sm mt-4">Discriminação do Serviço</p>
                            <div className="flex items-start gap-2">
                              <textarea 
                                readOnly 
                                value={currentFichas[currentFichaIndex].guestDataBlock || currentFichas[currentFichaIndex].serviceDescription} 
                                className="w-full h-32 p-2 text-sm border border-gray-300 rounded-md bg-white font-mono"
                              />
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(currentFichas[currentFichaIndex].guestDataBlock || currentFichas[currentFichaIndex].serviceDescription);
                                  setAlertMessage({ title: 'Copiado', message: 'Copiado para a área de transferência!', type: 'success' });
                                }}
                                className="px-3 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm font-medium whitespace-nowrap"
                              >
                                📋 Copiar
                              </button>
                            </div>
                          </div>

                          <div className="mt-6 border-t border-gray-200 pt-4">
                            <h5 className="text-md font-medium text-gray-800 mb-3">Dados Complementares</h5>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                              <div>
                                <p className="text-gray-500 mb-1">Data do Depósito</p>
                                <div className="flex items-center gap-2">
                                  <p className="font-medium text-gray-900">{formatDate(new Date(currentFichas[currentFichaIndex].depositDate))}</p>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(formatDate(new Date(currentFichas[currentFichaIndex].depositDate)));
                                      setAlertMessage({ title: 'Copiado', message: 'Data copiada!', type: 'success' });
                                    }}
                                    className="text-indigo-600 hover:text-indigo-800"
                                    title="Copiar Data"
                                  >
                                    📋
                                  </button>
                                </div>
                              </div>
                              <div>
                                <p className="text-gray-500 mb-1">Construção Civil</p>
                                <p className="font-medium text-gray-900">não se aplica</p>
                              </div>
                              <div>
                                <p className="text-gray-500 mb-1">Possui Subempreitada já tributada?</p>
                                <p className="font-medium text-gray-900">Não</p>
                              </div>
                            </div>
                          </div>

                          <div className="mt-6 border-t border-gray-200 pt-4">
                            <h5 className="text-md font-medium text-gray-800 mb-3">Resumo Final</h5>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm bg-gray-100 p-3 rounded-md">
                              <div>
                                <p className="text-gray-500 mb-1">Base de Cálculo</p>
                                <p className="font-medium text-gray-900">R$ {currentFichas[currentFichaIndex].grossValue.toFixed(2).replace('.', ',')}</p>
                              </div>
                              <div>
                                <p className="text-gray-500 mb-1">Alíquota ISS</p>
                                <p className="font-medium text-gray-900">{currentFichas[currentFichaIndex].issAliquota.toFixed(2).replace('.', ',')}%</p>
                              </div>
                              <div>
                                <p className="text-gray-500 mb-1">Valor do ISS</p>
                                <p className="font-medium text-gray-900">R$ {currentFichas[currentFichaIndex].issValue.toFixed(2).replace('.', ',')}</p>
                              </div>
                              <div>
                                <p className="text-gray-500 mb-1">Deduções</p>
                                <p className="font-medium text-gray-900">R$ 0,00</p>
                              </div>
                            </div>
                          </div>

                          <div className="mt-6 pt-4 border-t border-gray-200 flex justify-between items-center">
                            <button
                              onClick={() => window.open('https://www.tinus.com.br/csp/IPOJUCA/portal/', '_blank')}
                              className="px-4 py-2 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 text-sm font-medium"
                            >
                              🌐 Abrir Portal
                            </button>
                            
                            {currentFichas[currentFichaIndex].status === 'authorized' ? (
                              <div className="px-4 py-2 bg-green-100 text-green-800 rounded-md text-sm font-medium">
                                ✅ Autorizada {currentFichas[currentFichaIndex].nfseNumber ? `— Nº ${currentFichas[currentFichaIndex].nfseNumber}` : ''}
                              </div>
                            ) : currentFichas[currentFichaIndex].status === 'rejected' ? (
                              <div className="px-4 py-2 bg-red-100 text-red-800 rounded-md text-sm font-medium">
                                ❌ Rejeitada — {currentFichas[currentFichaIndex].rejectionReason}
                              </div>
                            ) : (
                              <div className="flex flex-col gap-2 items-end">
                                <div className="flex items-center gap-2">
                                  <input 
                                    type="text" 
                                    placeholder="Nº da NFS-e gerada" 
                                    id={`nfse-input-${currentFichas[currentFichaIndex].id}`}
                                    className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500 w-40"
                                  />
                                  <button
                                    onClick={() => {
                                      const input = document.getElementById(`nfse-input-${currentFichas[currentFichaIndex].id}`) as HTMLInputElement;
                                      const nfseNum = input ? input.value.trim() : '';
                                      updateRecordStatus(currentFichas[currentFichaIndex].id, 'authorized', nfseNum || undefined);
                                      setAlertMessage({ title: 'Sucesso', message: nfseNum ? `Nota marcada como emitida com número ${nfseNum}` : 'Nota marcada como emitida.', type: 'success' });
                                      // Update the local state of currentFichas to reflect the change immediately
                                      setCurrentFichas(prev => prev.map(f => f.id === currentFichas[currentFichaIndex].id ? { ...f, status: 'authorized', nfseNumber: nfseNum || undefined } : f));
                                    }}
                                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium whitespace-nowrap"
                                  >
                                    ✅ Marcar como Emitida
                                  </button>
                                </div>
                                <div className="flex items-center gap-2">
                                  <input 
                                    type="text" 
                                    placeholder="Motivo da rejeição" 
                                    id={`reject-input-${currentFichas[currentFichaIndex].id}`}
                                    className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-red-500 focus:border-red-500 w-40"
                                  />
                                  <button
                                    onClick={() => {
                                      const input = document.getElementById(`reject-input-${currentFichas[currentFichaIndex].id}`) as HTMLInputElement;
                                      if (input && input.value) {
                                        updateRecordStatus(currentFichas[currentFichaIndex].id, 'rejected', undefined, input.value);
                                        setAlertMessage({ title: 'Sucesso', message: `Nota marcada como rejeitada.`, type: 'success' });
                                        setCurrentFichas(prev => prev.map(f => f.id === currentFichas[currentFichaIndex].id ? { ...f, status: 'rejected', rejectionReason: input.value } : f));
                                      } else {
                                        setAlertMessage({ title: 'Atenção', message: 'Por favor, informe o motivo da rejeição.', type: 'warning' });
                                      }
                                    }}
                                    className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm font-medium whitespace-nowrap"
                                  >
                                    ❌ Rejeitar Nota
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={() => {
                    setFichasModalOpen(false);
                    setActiveTab('control');
                  }}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Manual Note Modal */}
      {manualNoteModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setManualNoteModalOpen(false)}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4" id="modal-title">
                      {editingNote ? 'Editar Nota' : 'Adicionar Nota Manual'}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Número RPS</label>
                        <input
                          type="number"
                          value={noteForm.rpsNumber || ''}
                          onChange={e => setNoteForm({ ...noteForm, rpsNumber: parseInt(e.target.value, 10) || 0 })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Data</label>
                        <input
                          type="date"
                          value={noteForm.depositDate ? noteForm.depositDate.split('T')[0] : ''}
                          onChange={e => {
                            const date = new Date(e.target.value);
                            setNoteForm({
                              ...noteForm,
                              depositDate: date.toISOString(),
                              competenceMonth: date.getUTCMonth() + 1,
                              competenceYear: date.getUTCFullYear(),
                            });
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Plataforma</label>
                        <input
                          type="text"
                          value={noteForm.platform || ''}
                          onChange={e => setNoteForm({ ...noteForm, platform: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Tomador (Razão Social)</label>
                        <input
                          type="text"
                          value={noteForm.tomadorRazaoSocial || ''}
                          onChange={e => setNoteForm({ ...noteForm, tomadorRazaoSocial: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Tomador (CPF/CNPJ)</label>
                        <input
                          type="text"
                          value={noteForm.tomadorCnpjCpf || ''}
                          onChange={e => setNoteForm({ ...noteForm, tomadorCnpjCpf: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Descrição do Serviço</label>
                        <textarea
                          value={noteForm.serviceDescription || ''}
                          onChange={e => setNoteForm({ ...noteForm, serviceDescription: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          rows={2}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Valor Bruto (R$)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={noteForm.grossValue || ''}
                          onChange={e => setNoteForm({ ...noteForm, grossValue: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Valor ISS (R$)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={noteForm.issValue || ''}
                          onChange={e => setNoteForm({ ...noteForm, issValue: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                        <select
                          value={noteForm.status || 'pending'}
                          onChange={e => setNoteForm({ ...noteForm, status: e.target.value as any })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          <option value="pending">Pendente</option>
                          <option value="authorized">Autorizada</option>
                          <option value="rejected">Rejeitada</option>
                        </select>
                      </div>
                      {noteForm.status === 'authorized' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Nº NFS-e</label>
                          <input
                            type="text"
                            value={noteForm.nfseNumber || ''}
                            onChange={e => setNoteForm({ ...noteForm, nfseNumber: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>
                      )}
                      {noteForm.status === 'rejected' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Motivo da Rejeição</label>
                          <input
                            type="text"
                            value={noteForm.rejectionReason || ''}
                            onChange={e => setNoteForm({ ...noteForm, rejectionReason: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={() => {
                    const newRecords = { ...nfseRecordsObj };
                    newRecords[noteForm.id!] = noteForm as NfseRecord;
                    
                    let updatedConfig = companyConfig;
                    if (!editingNote && noteForm.rpsNumber! > companyConfig.lastRpsNumber) {
                      updatedConfig = { ...configForm, lastRpsNumber: noteForm.rpsNumber! };
                    }
                    
                    Promise.all([
                      saveNfseData('nfseCompanyConfig', 'nfseCompanyConfig', updatedConfig),
                      saveNfseData('nfseRecords', 'nfseRecords', newRecords)
                    ]).then(() => {
                      if (!editingNote && noteForm.rpsNumber! > companyConfig.lastRpsNumber) {
                        onDataSave('nfseCompanyConfig', updatedConfig);
                        setCompanyConfig(updatedConfig);
                        setConfigForm(updatedConfig);
                      }
                      onDataSave('nfseRecords', newRecords);
                      setManualNoteModalOpen(false);
                      setAlertMessage({ title: 'Sucesso', message: 'Nota salva com sucesso!', type: 'success' });
                    }).catch(() => {
                      setAlertMessage({ title: 'Erro', message: 'Erro ao salvar a nota.', type: 'error' });
                    });
                  }}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Salvar
                </button>
                <button
                  type="button"
                  onClick={() => setManualNoteModalOpen(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Alert Modal */}
      {alertMessage && (
        <div className="fixed inset-0 z-[60] overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setAlertMessage(null)}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className={`mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full sm:mx-0 sm:h-10 sm:w-10 ${
                    alertMessage.type === 'success' ? 'bg-green-100' :
                    alertMessage.type === 'error' ? 'bg-red-100' : 'bg-yellow-100'
                  }`}>
                    {alertMessage.type === 'success' ? '✅' : alertMessage.type === 'error' ? '❌' : '⚠️'}
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                      {alertMessage.title}
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        {alertMessage.message}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={() => setAlertMessage(null)}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NfseControlReport;
