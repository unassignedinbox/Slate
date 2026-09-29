import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles.css';

// Deliberately not wrapped in <React.StrictMode>. Strict mode double-invokes
// effects, which here means constructing a second WebGL2 context on the same
// canvas and kicking off a second full terrain build before the first is torn
// down — a doubled cold start for no diagnostic benefit. The one effect that
// owns GPU state (App's engine effect) has a real cleanup path instead.
createRoot(document.getElementById('root')!).render(<App />);
