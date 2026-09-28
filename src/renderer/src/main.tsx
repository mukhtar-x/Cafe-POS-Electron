import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PosErrorBoundary } from './components/PosErrorBoundary';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <PosErrorBoundary><App /></PosErrorBoundary>
    </React.StrictMode>
);
