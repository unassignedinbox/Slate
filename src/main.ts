import './styles.css';
import { Editor } from './editor/app';
import { mountUI } from './editor/ui';

const host = document.getElementById('view')!;
const editor = new Editor(host);
mountUI(editor);
(window as unknown as { slate: Editor }).slate = editor;
