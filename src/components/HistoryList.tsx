import type { HistoryEntry } from '../storage/history';
import './HistoryList.css';

interface HistoryListProps {
  entries: HistoryEntry[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  unavailable?: boolean;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `aujourd'hui ${time}`;
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} ${time}`;
}

export function HistoryList({ entries, onOpen, onDelete, onClear, unavailable }: HistoryListProps) {
  if (unavailable) {
    return (
      <div className="history history-note">
        Le stockage local est inaccessible dans ce contexte (navigation privée ?) : les parties
        analysées ne pourront pas être conservées.
      </div>
    );
  }
  if (entries.length === 0) return null;

  return (
    <div className="history">
      <div className="history-head">
        <span className="history-title">Parties analysées ({entries.length})</span>
        <button type="button" className="btn btn-link" onClick={onClear}>
          Tout effacer
        </button>
      </div>
      <ul className="history-items">
        {entries.map((e) => (
          <li key={e.id} className="history-item">
            <button type="button" className="history-open" onClick={() => onOpen(e.id)}>
              <span className="history-players">
                {e.black || 'Sente'} <span className="history-vs">vs</span> {e.white || 'Gote'}
              </span>
              <span className="history-meta">
                {formatDate(e.savedAt)} · {e.moveCount} coups
                {e.blunders > 0 && (
                  <em style={{ color: 'var(--status-blunder)' }}> · {e.blunders} gaffe(s)</em>
                )}
                {e.mistakes > 0 && (
                  <em style={{ color: 'var(--status-mistake)' }}> · {e.mistakes} erreur(s)</em>
                )}
              </span>
            </button>
            <button
              type="button"
              className="history-delete"
              onClick={() => onDelete(e.id)}
              title="Retirer de l'historique"
              aria-label="Retirer de l'historique"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <p className="history-note">
        Conservé uniquement dans ce navigateur — rien n'est envoyé ailleurs. Rouvrir une partie est
        immédiat, l'analyse n'est pas refaite.
      </p>
    </div>
  );
}
