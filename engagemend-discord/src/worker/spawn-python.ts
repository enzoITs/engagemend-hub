import { spawn } from 'node:child_process';
export interface SpawnResult { exitCode: number; stdout: string; stderr: string; }
export function spawnYoutubePipeline(channelId: string, cwd: string): Promise<SpawnResult> { return new Promise((resolve) => { const child = spawn('python3', ['main.py', channelId], { cwd }); let stdout = ''; let stderr = ''; child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); }); child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); }); child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr })); }); }

/** Diretório do pacote `engagemend-whatsapp/` — `python -m src.cli` precisa rodar com ele como cwd pra achar o módulo e o `.env` do pipeline (ANON_HMAC_KEY, MAPPING_ENCRYPTION_KEY). */
const WHATSAPP_PIPELINE_DIR = process.env['WHATSAPP_PIPELINE_DIR'] ?? new URL('../../../engagemend-whatsapp/', import.meta.url).pathname;

export function spawnWhatsappPipeline(inputFile: string, groupName: string, outputDir: string): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(
      'python3',
      ['-m', 'src.cli', inputFile, '--grupo', groupName, '--saida', outputDir, '--formato', 'json'],
      { cwd: WHATSAPP_PIPELINE_DIR },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}
