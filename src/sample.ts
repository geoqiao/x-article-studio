export const SAMPLE = [
  '# A calmer way to publish',
  '',
  'Paste your Markdown on the left. Your article updates on the right, including images, tables, and diagrams.',
  '',
  '## Keep your writing workflow',
  '',
  'Use **Import Markdown** to open an existing file, or select this example and start writing. Add your pictures with the **Images** button above.',
  '',
  '![From first draft to finished article](assets/workflow.png)',
  '',
  '## Three things, handled',
  '',
  '| In your document | In your X Article |',
  '| --- | --- |',
  '| Images | Uploaded in the right place |',
  '| Tables | Native, readable tables |',
  '| Mermaid | Crisp diagram images |',
  '',
  '## A small workflow, a big difference',
  '',
  '```mermaid',
  'flowchart LR',
  '    A[Write Markdown] --> B[Live preview]',
  '    B --> C[Review X draft]',
  '```',
  '',
  '> Spend your time on the story. Let the tools handle the handoff.',
  '',
  '1. Paste or import your Markdown. The preview updates automatically.',
  '2. Use **Copy title** and **Copy body** for a manual paste into X.',
  '3. Use **Create X draft** to upload and place images automatically with the companion.',
  '',
  'Built on ideas from [Kaitox](https://github.com/kuangjiajia/kaitox-toolkit).',
].join('\n');

export async function createSampleImage(): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 560;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e6ece3'; ctx.fillRect(0, 0, 1200, 560);
  ctx.strokeStyle = '#d7dfd3'; ctx.lineWidth = 1;
  for (let x = 0; x <= 1200; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 560); ctx.stroke(); }
  for (let y = 0; y <= 560; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1200, y); ctx.stroke(); }
  ctx.save(); ctx.translate(370, 280); ctx.rotate(-0.10); ctx.shadowColor = '#213a2222'; ctx.shadowBlur = 25;
  ctx.fillStyle = '#fdfcf8'; ctx.beginPath(); ctx.roundRect(-145, -185, 290, 370, 12); ctx.fill(); ctx.shadowBlur = 0;
  ctx.fillStyle = '#76917e'; ctx.font = 'bold 19px monospace'; ctx.fillText('YOUR DRAFT', -108, -130);
  ctx.fillStyle = '#263e31'; ctx.font = 'bold 50px Georgia'; ctx.fillText('# Ideas', -110, -70);
  ctx.fillStyle = '#ccd6c8'; for (let i = 0; i < 6; i++) ctx.fillRect(-108, -28 + i * 27, i % 3 === 2 ? 120 : 210, 7);
  ctx.restore();
  ctx.save(); ctx.translate(805, 280); ctx.rotate(0.06); ctx.shadowColor = '#213a2222'; ctx.shadowBlur = 25;
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(-145, -185, 290, 370, 12); ctx.fill(); ctx.shadowBlur = 0;
  ctx.fillStyle = '#263e31'; ctx.font = 'bold 22px sans-serif'; ctx.fillText('𝕏 ARTICLE', -108, -130);
  ctx.font = 'bold 38px Georgia'; ctx.fillText('Ready to read.', -108, -78);
  ctx.fillStyle = '#dce8dd'; ctx.fillRect(-108, -43, 216, 88);
  ctx.fillStyle = '#7b9b7f'; ctx.beginPath(); ctx.moveTo(-108, 45); ctx.lineTo(-30, -18); ctx.lineTo(20, 23); ctx.lineTo(63, -5); ctx.lineTo(108, 45); ctx.fill();
  ctx.fillStyle = '#d8dfd5'; for (let i = 0; i < 3; i++) ctx.fillRect(-108, 75 + i * 26, i === 2 ? 135 : 216, 7);
  ctx.restore();
  ctx.fillStyle = '#405e49'; ctx.font = '42px sans-serif'; ctx.fillText('→', 563, 287);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Could not create sample image.')), 'image/png'));
  return new File([blob], 'workflow.png', { type: 'image/png' });
}
