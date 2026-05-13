
import React, { useEffect, useRef } from 'react';
import { ReportType } from '../types';

// Declare introJs to avoid TypeScript errors since it's loaded from a CDN
declare const introJs: any;

interface TourProps {
  startTour: boolean;
  onTourComplete: () => void;
  setActiveReport: (report: ReportType) => void;
}

const Tour: React.FC<TourProps> = ({ startTour, onTourComplete, setActiveReport }) => {
  const introRef = useRef<any | null>(null);

  useEffect(() => {
    if (startTour && !introRef.current) {
      const intro = introJs();
      introRef.current = intro;

      intro.setOptions({
        steps: [
          {
            title: 'Bem-vindo ao Gestão Flats! 👋',
            intro: 'Este é o seu painel completo de gerenciamento. Vamos fazer um tour detalhado para que você entenda como controlar suas finanças, limpezas e reservas com facilidade.',
          },
          {
            element: '[data-tour="step-2-import"]',
            title: 'Passo 1: Alimentando o Sistema 📥',
            intro: 'Para que os relatórios funcionem, o sistema precisa de dados. Use o botão <strong>"Importar Planilha"</strong> para carregar seu relatório de reservas (do Stays ou Excel).<br/><br/>📝 <em>Dica: Sempre exporte um relatório acumulado contendo todos os meses para garantir que o histórico esteja completo.</em>',
            position: 'right',
          },
          {
            element: '[data-tour="step-3-navigation"]',
            title: 'Passo 2: Navegação 🧭',
            intro: 'O menu lateral é o seu centro de comando. Ele está dividido em:<br/>🔹 <strong>Operacional:</strong> Calendários, Faxinas e Lavanderia.<br/>🔹 <strong>Financeiro:</strong> Relatórios de Lucro, Despesas e Impostos.<br/>🔹 <strong>Conciliação manual:</strong> Conferência de pagamentos bancários.',
            position: 'right',
          },
          {
            element: '[data-tour="step-4-filters"]',
            title: 'Passo 3: Definindo o Período 📅',
            intro: 'Tudo o que você vê na tela (gráficos, tabelas, valores) obedece a estes filtros. Selecione o <strong>Mês</strong> e o <strong>Ano</strong> que deseja analisar. Ao mudar aqui, a tela inteira se atualiza automaticamente.',
            position: 'bottom',
          },
          {
            element: '[data-tour="step-5-kpis"]',
            title: 'Passo 4: Visão Rápida (Dashboard) 📊',
            intro: 'Aqui você tem o "pulso" do seu negócio. Veja rapidamente quanto vendeu (Receita), quanto sobrou (Lucro) e a ocupação.<br/><br/>📈 <em>As setinhas (▲/▼) mostram se você está melhor ou pior que no mês passado.</em>',
            position: 'bottom',
          },
          {
            element: '[data-tour="step-6-charts"]',
            title: 'Passo 5: Análise Visual 📉',
            intro: 'Os gráficos ajudam a entender de onde vem o dinheiro (Airbnb, Booking, etc).<br/><br/>✨ <strong>Dica de Ouro:</strong> A maioria dos gráficos e cartões são clicáveis! Ao clicar neles, o sistema te leva para o relatório detalhado correspondente.',
            position: 'bottom',
          },
          {
            element: '[data-tour="step-7-expenses"]',
            title: 'Passo 6: Lançamentos Manuais ✍️',
            intro: 'O sistema importa as receitas, mas as <strong>despesas</strong> (como Condomínio e Energia) precisam ser informadas por você nos relatórios financeiros. Não se preocupe, mostraremos como fazer isso nas próximas telas.',
            position: 'top',
          },
          {
            title: 'Você está pronto! 🚀',
            intro: 'Agora você conhece o básico. Sinta-se à vontade para explorar cada menu. Em cada página, você encontrará um botão de ajuda <strong>(?)</strong> específico para aquele relatório.',
          }
        ],
        nextLabel: 'Próximo →',
        prevLabel: '← Anterior',
        doneLabel: 'Concluir',
        tooltipClass: 'custom-tooltip',
        exitOnOverlayClick: false,
        showProgress: true,
        width: 400
      });

      intro.onbeforechange((targetElement: HTMLElement) => {
        const stepId = targetElement.dataset.tour;

        if (stepId === 'step-7-expenses') {
          // Check if we are already on the financial report page
          if (document.querySelector('[data-tour="step-7-expenses"]') === null) {
            setActiveReport(ReportType.Financial);
            // We need to wait for the new component to render.
            // A simple timeout works well here.
            setTimeout(() => {
              intro.refresh(); // Refresh to find the new element
            }, 300);
          }
        } else {
           // Ensure we are back on the dashboard for other steps
           if (document.querySelector('[data-tour="step-5-kpis"]') === null) {
             setActiveReport(ReportType.Dashboard);
             setTimeout(() => {
              intro.refresh();
            }, 300);
           }
        }
      });

      intro.oncomplete(onTourComplete);
      intro.onexit(onTourComplete);

      intro.start();
    } else if (!startTour && introRef.current) {
        introRef.current.exit();
        introRef.current = null;
    }
  }, [startTour, onTourComplete, setActiveReport]);

  return null; // This component does not render anything itself
};

export default Tour;
