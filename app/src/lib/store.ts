import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Agents and their activity log aren't part of `MarketEngine` (which only
 * knows about markets) — they're the app's own bookkeeping of "which agent
 * process said/did what," fed by `POST /api/agents/register` and
 * `POST /api/agents/:id/activity`. Backed by a single JSON file rather than a
 * real database: this is a hackathon demo venue, and a file needs no setup.
 */

export interface AgentRecord {
  id: string;
  name: string;
  role: "creator" | "bettor";
  persona: string;
  avatarEmoji?: string;
  registeredAt: number;
  lastActiveAt: number;
  /**
   * The Somnia wallet this agent pays x402 platform fees (and trades
   * DreamDEX directly) from — see contracts/doc/x402/X402.md. Declared at
   * registration, or left unset and opportunistically bound to the first
   * wallet the app observes paying that agentId's fee (see
   * `bindAgentWallet` and `app/src/lib/x402.ts`'s `verifyOnChainPayment`).
   */
  walletAddress?: string;
  /**
   * This agent's ERC-8004 Identity Registry tokenId (contracts/doc/erc8004/ERC8004.md) — a
   * string since it's a uint256 on-chain. Additive: doesn't replace `id` above, which stays the
   * agent's primary key everywhere in this app. Bound once `POST /api/agents/:id/erc8004`
   * records a completed on-chain `register()` call; `walletAddress` must hold that NFT for
   * `X402FeeVault.payFee` to let this agent buy shares at all.
   */
  erc8004AgentId?: string;
  /**
   * The transaction hash of the `IdentityRegistry.register()` call that minted
   * `erc8004AgentId` above — only known when this app's own registration paths
   * (`POST /api/register-agent`, `register_erc8004_identity`) performed the registration
   * themselves; a self-healed `erc8004AgentId` (recovered by probing `ownerOf` on GET
   * /api/agents/:id/erc8004) has no known tx hash. Powers the /agents table's "Registered" link.
   */
  erc8004TxHash?: string;
}

export interface ActivityEntry {
  agentId: string;
  timestamp: number;
  kind: "reasoning" | "action" | "error";
  message: string;
  data?: Record<string, unknown>;
}

const MAX_ACTIVITY = 500;
const DATA_DIR = path.resolve(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

interface Snapshot {
  agents: AgentRecord[];
  activity: ActivityEntry[];
}

class Store {
  agents = new Map<string, AgentRecord>();
  activity: ActivityEntry[] = [];
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
    this.load();
  }

  private load() {
    try {
      if (!existsSync(DATA_FILE)) return;
      const snap = JSON.parse(readFileSync(DATA_FILE, "utf-8")) as Snapshot;
      for (const a of snap.agents ?? []) this.agents.set(a.id, a);
      this.activity = snap.activity ?? [];
    } catch (err) {
      console.warn("[store] failed to load persisted state, starting fresh:", err);
    }
  }

  private persist() {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
      const snap: Snapshot = { agents: [...this.agents.values()], activity: this.activity.slice(-MAX_ACTIVITY) };
      writeFileSync(DATA_FILE, JSON.stringify(snap, null, 2));
    } catch (err) {
      console.warn("[store] failed to persist state:", err);
    }
  }

  registerAgent(input: Omit<AgentRecord, "registeredAt" | "lastActiveAt">) {
    const existing = this.agents.get(input.id);
    const record: AgentRecord = {
      ...input,
      // A re-register call that omits walletAddress (e.g. agents/proxy-servers
      // re-registering on every boot) must not clobber a binding already
      // made — either declared at an earlier registration, or bound
      // opportunistically by `bindAgentWallet` from an observed x402 payment.
      walletAddress: input.walletAddress ?? existing?.walletAddress,
      registeredAt: existing?.registeredAt ?? Date.now() / 1000,
      lastActiveAt: Date.now() / 1000,
    };
    this.agents.set(input.id, record);
    this.persist();
    this.emitter.emit("agent", record);
    return record;
  }

  listAgents(): AgentRecord[] {
    return [...this.agents.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  getAgent(id: string): AgentRecord | undefined {
    return this.agents.get(id);
  }

  /** Opportunistic wallet↔agent binding: only sets it if the agent is known
   * and doesn't already have one declared — never overwrites an existing
   * binding. See `AgentRecord.walletAddress`. */
  bindAgentWallet(id: string, walletAddress: string) {
    const agent = this.agents.get(id);
    if (!agent || agent.walletAddress) return;
    agent.walletAddress = walletAddress;
    this.persist();
  }

  /** Records a completed ERC-8004 registration — never overwrites an existing binding, same
   * never-clobber rule as `bindAgentWallet`. See `AgentRecord.erc8004AgentId`. */
  bindAgentErc8004Id(id: string, erc8004AgentId: string, txHash?: string) {
    const agent = this.agents.get(id);
    if (!agent || agent.erc8004AgentId) return;
    agent.erc8004AgentId = erc8004AgentId;
    if (txHash) agent.erc8004TxHash = txHash;
    this.persist();
  }

  addActivity(entry: ActivityEntry) {
    this.activity.push(entry);
    if (this.activity.length > MAX_ACTIVITY * 2) this.activity = this.activity.slice(-MAX_ACTIVITY);
    const agent = this.agents.get(entry.agentId);
    if (agent) agent.lastActiveAt = entry.timestamp;
    this.persist();
    this.emitter.emit("activity", entry);
  }

  getActivity(agentId?: string, limit = 50): ActivityEntry[] {
    const all = agentId ? this.activity.filter((a) => a.agentId === agentId) : this.activity;
    return all.slice(-limit).reverse();
  }

  onAgent(cb: (a: AgentRecord) => void): () => void {
    this.emitter.on("agent", cb);
    return () => this.emitter.off("agent", cb);
  }

  onActivity(cb: (a: ActivityEntry) => void): () => void {
    this.emitter.on("activity", cb);
    return () => this.emitter.off("activity", cb);
  }
}

declare global {
  var __apmStore: Store | undefined;
}

export function getStore(): Store {
  if (!globalThis.__apmStore) globalThis.__apmStore = new Store();
  return globalThis.__apmStore;
}
