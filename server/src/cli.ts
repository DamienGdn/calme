import { createRuntime } from './runtime.ts';
import { syncInbox } from './sync.ts';
import { runTriage } from './triage.ts';
import { CATEGORY_LABELS } from './types.ts';

const HELP = `Usage : pnpm calme <commande>
  pair      affiche le jeton d’appairage à saisir dans l’app
  auth      explique comment connecter Gmail
  sync      relève les mails
  triage    fait trier par Claude les mails non analysés
  cycle     relève + tri + notifications
  status    compteurs par catégorie
  list [reply|read|news|trash]   liste les mails triés`;

const rt = createRuntime();
const [cmd, arg] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case 'pair':
      console.log(`Adresse locale : http://127.0.0.1:${rt.cfg.port}`);
      console.log(`Jeton : ${rt.cfg.pairingToken}`);
      return;
    case 'auth':
      if (!rt.oauth.hasCredentials()) return console.log(`Dépose d’abord credentials.json dans ${rt.cfg.home} (voir README).`);
      return console.log(`Serveur lancé (pnpm start), ouvre sur ce PC : http://127.0.0.1:${rt.cfg.port}/auth/google`);
    case 'sync': {
      const g = rt.gmail();
      if (!g) return console.log('Gmail non connecté : pnpm calme auth');
      console.log(`${(await syncInbox(g, rt.store)).added} nouveaux mails`);
      return;
    }
    case 'triage':
      console.log(`${(await runTriage(rt.runner, rt.store, console.error, await rt.agenda(console.error))).length} mails triés`);
      console.log(rt.summary());
      return;
    case 'cycle':
      await rt.runCycle();
      console.log(rt.summary());
      return;
    case 'status':
      console.log(rt.summary());
      if (rt.store.countUnanalyzed()) console.log(`${rt.store.countUnanalyzed()} en attente de tri`);
      return;
    case 'list':
      for (const m of rt.store.listInbox(arg as never)) {
        const a = m.analysis;
        console.log(`${a ? CATEGORY_LABELS[a.category].padEnd(12) : 'non trié'.padEnd(12)} ${m.fromName} — ${m.subject}${a ? `\n             → ${a.action}` : ''}`);
      }
      return;
    default:
      console.log(HELP);
  }
}

await main();
