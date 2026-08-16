import { spawn } from 'node:child_process';
export interface SpawnResult { exitCode: number; stdout: string; stderr: string; }
export function spawnYoutubePipeline(channelId: string, cwd: string): Promise<SpawnResult> { return new Promise((resolve) => { const child = spawn('python3', ['main.py', channelId], { cwd }); let stdout = ''; let stderr = ''; child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); }); child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); }); child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr })); }); }
