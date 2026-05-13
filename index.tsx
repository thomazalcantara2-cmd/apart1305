
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { Chart, Tooltip, Legend, Title, LinearScale, CategoryScale, BarElement, PointElement, LineElement, ArcElement, Filler } from 'chart.js';

// Register Chart.js components (if not already registered globally, though usually auto-registered in browser builds)
Chart.register(Tooltip, Legend, Title, LinearScale, CategoryScale, BarElement, PointElement, LineElement, ArcElement, Filler);

// Global Chart.js Defaults
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.color = '#64748b'; // Slate 500
Chart.defaults.scale.grid.color = '#f1f5f9'; // Slate 100 (very subtle)
Chart.defaults.scale.grid.tickColor = 'transparent'; // Hide tick marks

// Tooltip Styling
Chart.defaults.plugins.tooltip.backgroundColor = '#1e293b'; // Slate 800
Chart.defaults.plugins.tooltip.titleColor = '#f8fafc'; // Slate 50
Chart.defaults.plugins.tooltip.bodyColor = '#f8fafc'; // Slate 50
Chart.defaults.plugins.tooltip.padding = 12;
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.displayColors = true;
Chart.defaults.plugins.tooltip.boxPadding = 4;

// Legend Styling
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.boxWidth = 8;
Chart.defaults.plugins.legend.labels.padding = 20;

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
