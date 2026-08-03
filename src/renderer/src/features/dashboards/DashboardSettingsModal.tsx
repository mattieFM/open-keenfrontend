import { Check } from 'lucide-react';
import type { DashboardDocument } from '@shared/types';
import { Button, Field, Input, Modal } from '../../components/ui';

const PRESETS: Array<{ name: string; background: string; tile: string; radius: number; palette: string[] }> = [
  { name: 'Keen light', background: '#eef1f6', tile: '#ffffff', radius: 8, palette: ['#6f5bd3', '#13b98a', '#2873d6', '#ef9f32', '#d94b72', '#3aa6a0', '#8b6fd9'] },
  { name: 'Ocean', background: '#eaf3f8', tile: '#ffffff', radius: 12, palette: ['#236f9f', '#2aa6a1', '#7d67c8', '#e19a3c', '#d15e72', '#4d88c7'] },
  { name: 'Warm studio', background: '#f6f1ec', tile: '#fffdf9', radius: 10, palette: ['#815ac0', '#d46a4c', '#d6a339', '#3e927d', '#4678b8', '#a65774'] },
  { name: 'High contrast', background: '#f2f2f2', tile: '#ffffff', radius: 4, palette: ['#3c238b', '#006b4d', '#0059a8', '#a94f00', '#a00040', '#006c70'] }
];

export function DashboardSettingsModal({ document, onSave, onClose }: { document: DashboardDocument; onSave(document: DashboardDocument): void; onClose(): void }): JSX.Element {
  const palette = document.theme.palette.length ? document.theme.palette : PRESETS[0].palette;
  const patchPalette = (index: number, value: string) => onSave({ ...document, theme: { ...document.theme, palette: palette.map((color, itemIndex) => itemIndex === index ? value : color) } });
  return <Modal wide title="Dashboard appearance" description="Choose a preset or tune the canvas, cards, spacing, and chart palette visually." onClose={onClose} footer={<Button onClick={onClose}><Check size={15} /> Done</Button>}>
    <div className="stack">
      <div className="dashboard-theme-presets">{PRESETS.map((preset) => <button type="button" key={preset.name} className="dashboard-theme-preset" onClick={() => onSave({ ...document, settings: { ...document.settings, background: preset.background, tileBackground: preset.tile, tileRadius: preset.radius }, theme: { ...document.theme, palette: preset.palette } })}><span className="dashboard-theme-preset__swatches">{preset.palette.slice(0, 5).map((color) => <i key={color} style={{ background: color }} />)}</span><strong>{preset.name}</strong></button>)}</div>
      <div className="form-grid form-grid--3"><Field label="Canvas color"><Input type="color" value={document.settings.background} onChange={(event) => onSave({ ...document, settings: { ...document.settings, background: event.target.value } })} /></Field><Field label="Widget color"><Input type="color" value={document.settings.tileBackground} onChange={(event) => onSave({ ...document, settings: { ...document.settings, tileBackground: event.target.value } })} /></Field><Field label="Corner radius"><Input type="number" min="0" max="36" value={document.settings.tileRadius} onChange={(event) => onSave({ ...document, settings: { ...document.settings, tileRadius: Number(event.target.value) } })} /></Field><Field label="Grid spacing"><Input type="number" min="0" max="40" value={document.settings.gridGap} onChange={(event) => onSave({ ...document, settings: { ...document.settings, gridGap: Number(event.target.value) } })} /></Field></div>
      <div className="stack stack--compact"><strong className="small">Chart colors</strong><div className="dashboard-palette-editor">{palette.map((color, index) => <label key={`${index}-${color}`}><span>Series {index + 1}</span><Input aria-label={`Series ${index + 1} color`} type="color" value={color} onChange={(event) => patchPalette(index, event.target.value)} /></label>)}</div></div>
    </div>
  </Modal>;
}
