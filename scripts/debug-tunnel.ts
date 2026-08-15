/**
 * Dev probe: how does this Node version's https.Agent engage proxy tunneling?
 * Run: node --import tsx/esm scripts/debug-tunnel.ts
 */

import * as https from 'node:https'

function probe(name: string, options: https.AgentOptions): void {
  const agent = new https.Agent(options)
  const symbols = Object.getOwnPropertySymbols(agent).map(s => s.toString())
  const proxySymbol = symbols.filter(s => s.toLowerCase().includes('proxy'))
  console.log(name, '→ symbols mentioning proxy:', proxySymbol, '| own props:', Object.keys(agent).slice(0, 6))
  agent.destroy()
}

probe('proxyEnv', { keepAlive: true, proxyEnv: { HTTPS_PROXY: 'http://127.0.0.1:7890' } } as https.AgentOptions)
probe('plain', { keepAlive: true })
