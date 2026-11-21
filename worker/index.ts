import { OrganizerStore, type Env } from './store'

export { OrganizerStore }

/**
 * Einstieg: statische App-Dateien kommen direkt aus den Assets,
 * alles unter /api/ geht an das eine Durable Object, das die Daten hält.
 */
export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req)
    return env.STORE.get(env.STORE.idFromName('main')).fetch(req)
  },
} satisfies ExportedHandler<Env>
