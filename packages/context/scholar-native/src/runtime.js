/**
 * Owner-scoped Scholar prompt enrichment and durable citation auditing.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import z from '@deepseek-ai/schemastery';

export const name = 'scholar-native';
export const inject = ['systemPrompt'];
export const Config = z.object({
  enabled: z.boolean(),
  scholarHome: z.string(),
  debug: z.boolean(),
  personaOrder: z.number(),
  interestsOrder: z.number(),
  literatureOrder: z.number(),
  literatureMaxBytes: z.number(),
  ruleMaxChars: z.number(),
  abstractSnippetChars: z.number(),
  indexAbstractChars: z.number(),
  topK: z.number(),
  minScore: z.number(),
  maxCitationKeys: z.number(),
  maxSessionTopics: z.number(),
});

const PERSONA_SECTION = 'scholar-persona';
const INTERESTS_SECTION = 'scholar-session-interests';
const LITERATURE_SECTION = 'scholar-literature-context';
const WRITING_TOOLS = new Set(['write', 'str_replace_editor']);
const STOPWORDS = new Set((
  'the a an and or of for to in on with by from as at is are was were be been this that these those '
  + 'it its their his her our your my not no do does did done can could should would will shall may might must '
  + 'how what why when where which who whom whose about into over under between within without during through '
  + 'using use used based paper papers method methods model models approach approaches result results new novel '
  + 'please explain describe tell say make give show help like also more most some any all both each other than then '
  + 'you i we they he she them us him me here there when what have has had having let get got'
).split(' '));

function positiveInteger(value, fallback, label) {
  const resolved = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`scholar-native: ${label} must be a positive integer`);
  }
  return resolved;
}

function finiteNumber(value, fallback, label) {
  const resolved = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new Error(`scholar-native: ${label} must be a non-negative number`);
  }
  return resolved;
}

/**
 * Resolve plugin-local paths, limits, and state.
 * @param {object} config - Scholar home and enrichment limits.
 * @returns {object} isolated runtime used by one plugin application.
 */
export function createScholarRuntime(config = {}) {
  const enabled = config.enabled ?? true;
  if (!enabled) return { enabled, states: new WeakMap() };
  if (typeof config.scholarHome !== 'string' || config.scholarHome.length === 0) {
    throw new Error('scholar-native: scholarHome is required while enabled');
  }
  return {
    enabled,
    scholarHome: resolve(config.scholarHome),
    debug: config.debug ?? false,
    personaOrder: finiteNumber(config.personaOrder, 110, 'personaOrder'),
    interestsOrder: finiteNumber(config.interestsOrder, 120, 'interestsOrder'),
    literatureOrder: finiteNumber(config.literatureOrder, 150, 'literatureOrder'),
    literatureMaxBytes: positiveInteger(config.literatureMaxBytes, 2_200, 'literatureMaxBytes'),
    ruleMaxChars: positiveInteger(config.ruleMaxChars, 900, 'ruleMaxChars'),
    abstractSnippetChars: positiveInteger(
      config.abstractSnippetChars,
      160,
      'abstractSnippetChars',
    ),
    indexAbstractChars: positiveInteger(config.indexAbstractChars, 400, 'indexAbstractChars'),
    topK: positiveInteger(config.topK, 5, 'topK'),
    minScore: finiteNumber(config.minScore, 5, 'minScore'),
    maxCitationKeys: positiveInteger(config.maxCitationKeys, 15, 'maxCitationKeys'),
    maxSessionTopics: positiveInteger(config.maxSessionTopics, 30, 'maxSessionTopics'),
    states: new WeakMap(),
  };
}

function debug(runtime, ...values) {
  if (runtime.debug) console.log('[scholar-native:debug]', ...values);
}

/**
 * Read the latest human-authored text from a message list.
 * @param {Array<object>} messages - candidate user and assistant messages.
 * @returns {string} latest non-empty user text.
 */
export function extractUserText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user' || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join(' ')
      .trim();
    if (text.length > 0) return text;
  }
  return '';
}

/**
 * Tokenize mixed English and Chinese research text.
 * @param {string} text - human-authored research query.
 * @returns {string[]} unique terms in encounter order.
 */
export function extractTerms(text) {
  if (!text) return [];
  const terms = [];
  const latin = text.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? [];
  for (const raw of latin) {
    const word = raw.replace(/[.+-]+$/, '');
    if (word.length >= 3 && !STOPWORDS.has(word)) terms.push(word);
  }
  const cjk = text.match(/[\u4e00-\u9fff]/g) ?? [];
  for (let index = 0; index + 1 < cjk.length; index += 1) {
    terms.push(cjk[index] + cjk[index + 1]);
  }
  return [...new Set(terms)];
}

function topicHash(terms) {
  return terms.length === 0
    ? ''
    : createHash('sha256').update(terms.join('|')).digest('hex').slice(0, 16);
}

/**
 * Rank a metadata index using bounded lexical scoring.
 * @param {Array<object>} index - parsed paper metadata.
 * @param {string[]} terms - normalized query terms.
 * @param {object} options - topK and minimum score.
 * @returns {Array<object>} ranked paper entries with `_score`.
 */
export function search(index, terms, options = {}) {
  if (!Array.isArray(index) || terms.length === 0) return [];
  const topK = positiveInteger(options.topK, 5, 'topK');
  const minScore = finiteNumber(options.minScore, 5, 'minScore');
  const hits = [];
  for (const paper of index) {
    const title = String(paper.title ?? '').toLowerCase();
    const abstract = String(paper.abstract ?? '').toLowerCase();
    const tags = Array.isArray(paper.tags) ? paper.tags.join(' ').toLowerCase() : '';
    if (title.length === 0 && abstract.length === 0) continue;
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      if (title.includes(term)) {
        score += 4;
        matched += 1;
      }
      if (tags.includes(term)) {
        score += 2;
        matched += 1;
      }
      let count = 0;
      for (
        let offset = abstract.indexOf(term);
        offset !== -1 && count < 3;
        offset = abstract.indexOf(term, offset + term.length)
      ) {
        score += 1;
        count += 1;
      }
      if (count > 0) matched += 1;
    }
    if (terms.length >= 2) {
      const phrase = `${terms[0]} ${terms[1]}`;
      if (title.includes(phrase) || abstract.includes(phrase)) score += 3;
    }
    if (score >= minScore && matched >= 2) hits.push({ ...paper, _score: score });
  }
  hits.sort((left, right) => right._score - left._score);
  return hits.slice(0, topK);
}

/**
 * Render bounded paper metadata for the current request.
 * @param {Array<object>} hits - ranked metadata entries.
 * @param {object} options - byte and abstract limits.
 * @returns {string} literature context or an empty string.
 */
export function buildLitBlock(hits, options = {}) {
  if (!Array.isArray(hits) || hits.length === 0) return '';
  const maxBytes = positiveInteger(options.maxBytes, 2_200, 'maxBytes');
  const abstractChars = positiveInteger(options.abstractChars, 160, 'abstractChars');
  const lines = [
    '<literature_context>',
    'Papers from the configured research library that appear relevant to the current topic:',
  ];
  for (const hit of hits) {
    const abstract = String(hit.abstract ?? '').replace(/\s+/g, ' ');
    const snippet = abstract.slice(0, abstractChars);
    let line = `- [${hit.id ?? hit.paper_id ?? '?'}] ${hit.title ?? 'untitled'} (${hit.year ?? 'n.y.'}`;
    if (hit.venue) line += `, ${hit.venue}`;
    line += ')';
    if (snippet.length > 0) line += ` — ${snippet}${abstract.length > abstractChars ? '…' : ''}`;
    const candidate = [
      ...lines,
      line,
      'Cite these as paper_id when relevant; verify claims with Scholar tools.',
      '</literature_context>',
    ].join('\n');
    if (Buffer.byteLength(candidate, 'utf8') > maxBytes) break;
    lines.push(line);
  }
  if (lines.length === 2) return '';
  lines.push('Cite these as paper_id when relevant; verify claims with Scholar tools.');
  lines.push('</literature_context>');
  return lines.join('\n');
}

/** @param {object} runtime - plugin-local Scholar runtime. @returns {string} parsed-paper directory. */
export function parsedDir(runtime) {
  return join(runtime.scholarHome, 'output', 'parsed');
}

/** @param {object} runtime - plugin-local Scholar runtime. @returns {string} metadata-cache path. */
export function indexCachePath(runtime) {
  return join(runtime.scholarHome, 'output', 'index', 'scholar-native-index.json');
}

function sourceFingerprint(directory) {
  const digest = createHash('sha256');
  if (!existsSync(directory)) return digest.digest('hex');
  for (const filename of readdirSync(directory).filter(value => value.endsWith('.json')).sort()) {
    const file = join(directory, filename);
    const stat = statSync(file, { bigint: true });
    digest.update(filename);
    digest.update(String(stat.size));
    digest.update(String(stat.mtimeNs));
  }
  return digest.digest('hex');
}

function buildIndex(runtime, directory) {
  const entries = [];
  for (const filename of readdirSync(directory)) {
    if (!filename.endsWith('.json')) continue;
    try {
      const paper = JSON.parse(readFileSync(join(directory, filename), 'utf8'));
      entries.push({
        id: paper.paper_id ?? filename.replace(/\.json$/, ''),
        title: paper.title ?? '',
        year: paper.year ?? null,
        venue: paper.venue ?? '',
        abstract: String(paper.abstract ?? '').slice(0, runtime.indexAbstractChars),
        tags: Array.isArray(paper.tags) ? paper.tags : [],
      });
    } catch {
      // A malformed corpus entry is omitted; Scholar MCP remains authoritative.
    }
  }
  return entries;
}

/**
 * Load or rebuild the local metadata cache.
 * @param {object} runtime - plugin-local Scholar runtime.
 * @param {AbortSignal} signal - assembly or tool-operation cancellation.
 * @returns {Array<object>} parsed metadata entries.
 */
export function ensureIndex(runtime, signal) {
  const directory = parsedDir(runtime);
  if (!existsSync(directory)) return [];
  const fingerprint = sourceFingerprint(directory);
  const cache = indexCachePath(runtime);
  if (existsSync(cache)) {
    try {
      const parsed = JSON.parse(readFileSync(cache, 'utf8'));
      if (Array.isArray(parsed.entries) && parsed.sourceFingerprint === fingerprint) {
        return parsed.entries;
      }
    } catch {
      // A malformed derived cache is replaced from the corpus metadata.
    }
  }
  signal?.throwIfAborted();
  const entries = buildIndex(runtime, directory);
  signal?.throwIfAborted();
  mkdirSync(dirname(cache), { recursive: true });
  const temporary = `${cache}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ sourceFingerprint: fingerprint, entries }), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    renameSync(temporary, cache);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  debug(runtime, 'metadata index rebuilt', entries.length);
  return entries;
}

function readRule(runtime, filename) {
  try {
    return readFileSync(join(runtime.scholarHome, '.scholar', 'rules', filename), 'utf8')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, runtime.ruleMaxChars);
  } catch {
    return '';
  }
}

/**
 * Render the static Scholar persona without corpus-size claims.
 * @param {object} runtime - plugin-local Scholar runtime.
 * @returns {string} Scholar system section.
 */
export function buildPersona(runtime) {
  if (!runtime.enabled) return '';
  const lines = [
    '<scholar_persona>',
    'You are a scholarly research agent with access to a configured paper corpus through Scholar tools.',
    'Use scholar_search or scholar_vec_search to find papers, scholar_info to inspect abstracts and section tables, and scholar_section to read only the sections needed for the task.',
    'Search related work before technical proposals, cite exact paper_id, title, and year, and never invent a corpus record.',
    'Use citation-network tools for lineage and structural questions, and distinguish corpus evidence from general knowledge.',
    'Place reading notes and drafts under the current workspace output directory.',
  ];
  const identity = readRule(runtime, 'identity.md');
  const academic = readRule(runtime, 'academic.md');
  if (identity.length > 0) lines.push(`Researcher profile: ${identity}`);
  if (academic.length > 0) lines.push(`Academic norms: ${academic}`);
  lines.push('</scholar_persona>');
  return lines.join('\n');
}

function humanMessages(agent) {
  return agent.session.events.flatMap(event => (
    event.type === 'user/message' && event.data?.source?.kind === 'user'
      ? [event.data]
      : []
  ));
}

function stateFor(runtime, owner) {
  const existing = runtime.states.get(owner);
  if (existing !== undefined) return existing;
  const created = { topicHash: '', litBlock: '' };
  runtime.states.set(owner, created);
  return created;
}

/**
 * Refresh one owner's literature block from durable human messages.
 * @param {object} runtime - plugin-local Scholar runtime.
 * @param {object} owner - live agent owning the assembly.
 * @param {Array<object>} messages - durable human messages.
 * @param {AbortSignal} signal - assembly cancellation.
 * @returns {Promise<boolean>} whether the topic changed.
 */
export async function refreshTopicFromMessages(runtime, owner, messages, signal) {
  const terms = extractTerms(extractUserText(messages));
  const hash = topicHash(terms);
  const state = stateFor(runtime, owner);
  if (hash.length === 0 || hash === state.topicHash) return false;
  const index = ensureIndex(runtime, signal);
  state.topicHash = hash;
  state.litBlock = buildLitBlock(
    search(index, terms, { topK: runtime.topK, minScore: runtime.minScore }),
    {
      maxBytes: runtime.literatureMaxBytes,
      abstractChars: runtime.abstractSnippetChars,
    },
  );
  return true;
}

/**
 * Derive bounded session interests from durable human messages.
 * @param {object} runtime - plugin-local Scholar runtime.
 * @param {object} agent - assembly owner.
 * @returns {string} session-interest section or an empty string.
 */
export function sessionInterestsBlock(runtime, agent) {
  if (agent === undefined) return '';
  const topics = [];
  for (const message of humanMessages(agent)) {
    for (const term of extractTerms(extractUserText([message]))) {
      if (term.length >= 3 && !topics.includes(term)) topics.push(term);
      if (topics.length >= runtime.maxSessionTopics) break;
    }
    if (topics.length >= runtime.maxSessionTopics) break;
  }
  if (topics.length === 0) return '';
  return [
    '<scholar_session_interests>',
    'Research threads touched in this session:',
    topics.join(', '),
    '</scholar_session_interests>',
  ].join('\n');
}

/**
 * Extract bounded LaTeX and BibTeX citation keys.
 * @param {string} text - persisted file contents.
 * @param {number} maximum - maximum returned keys.
 * @returns {string[]} unique keys.
 */
export function extractCiteKeys(text, maximum = 15) {
  const keys = [];
  const pattern = /\\(?:cite|citep|citet|bibitem)\*?(?:\[[^\]]*\]){0,2}\{([^}]+)\}/g;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    for (const raw of match[1].split(',')) {
      const key = raw.trim();
      if (key.length > 0 && !keys.includes(key)) keys.push(key);
      if (keys.length >= maximum) return keys;
    }
  }
  return keys;
}

/**
 * Render a bounded citation comparison against the local metadata index.
 * @param {string[]} keys - detected citation keys.
 * @param {Array<object>} index - local metadata index.
 * @param {object} runtime - plugin-local Scholar runtime.
 * @returns {string} citation audit or an empty string.
 */
export function buildCitationAudit(keys, index, runtime) {
  if (keys.length === 0) return '';
  const lines = [
    '<citation_audit>',
    'Citation keys detected in the completed LaTeX or BibTeX write:',
  ];
  for (const key of keys) {
    const hits = search(index, extractTerms(key.replace(/\d+/g, ' ')), {
      topK: 1,
      minScore: runtime.minScore,
    });
    const nearest = hits[0];
    const line = nearest === undefined
      ? `- ${key} → no local metadata match; verify the reference before finishing`
      : `- ${key} → nearest [${nearest.id}] ${nearest.title} (${nearest.year ?? 'n.y.'}); confirm it is the intended source`;
    const candidate = [...lines, line, '</citation_audit>'].join('\n');
    if (Buffer.byteLength(candidate, 'utf8') > runtime.literatureMaxBytes) break;
    lines.push(line);
  }
  lines.push('</citation_audit>');
  return lines.join('\n');
}

function writtenPath(toolName, args) {
  if (toolName === 'write') return args?.file_path;
  if (
    toolName === 'str_replace_editor'
    && ['create', 'str_replace', 'insert'].includes(args?.command)
  ) {
    return args?.path;
  }
  return undefined;
}

/**
 * Audit a successful Scholar-relevant write from its persisted contents.
 * @param {object} runtime - plugin-local Scholar runtime.
 * @param {string} toolName - completed DSH tool.
 * @param {object} args - logged tool arguments.
 * @param {AbortSignal} signal - tool-operation cancellation.
 * @returns {string} citation audit or an empty string.
 */
export function auditWrittenFile(runtime, toolName, args, signal) {
  if (!WRITING_TOOLS.has(toolName)) return '';
  const filename = writtenPath(toolName, args);
  if (typeof filename !== 'string' || !/\.(tex|bib)$/i.test(filename)) return '';
  signal?.throwIfAborted();
  const text = readFileSync(filename, 'utf8');
  const keys = extractCiteKeys(text, runtime.maxCitationKeys);
  if (keys.length === 0) return '';
  return buildCitationAudit(keys, ensureIndex(runtime, signal), runtime);
}

function citationMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: 'plugin',
      plugin: name,
      form: 'notice',
      summary: 'Scholar checked citations in the completed academic file write.',
    },
  };
}

function replaceSection(assembly, sectionName, text) {
  const section = assembly.sections.find(candidate => candidate.name === sectionName);
  if (section !== undefined) section.text = text;
}

/**
 * Install Scholar sections, same-request enrichment, and durable citation auditing.
 * @param {object} ctx - DSH plugin context.
 * @param {object} config - Scholar home, enable flag, orders, and limits.
 */
export function apply(ctx, config = {}) {
  const runtime = createScholarRuntime(config);
  if (!runtime.enabled) return;
  const disposePersona = ctx.systemPrompt.section({
    name: PERSONA_SECTION,
    order: runtime.personaOrder,
    text: buildPersona(runtime),
  });
  const disposeInterests = ctx.systemPrompt.section({
    name: INTERESTS_SECTION,
    order: runtime.interestsOrder,
    text: context => sessionInterestsBlock(runtime, context.agent),
  });
  const disposeLiterature = ctx.systemPrompt.section({
    name: LITERATURE_SECTION,
    order: runtime.literatureOrder,
    text: context => (
      context.agent === undefined
        ? ''
        : stateFor(runtime, context.agent).litBlock
    ),
  });

  const disposeAssembly = ctx.on(
    'system-prompt/assemble',
    async (assembly, context, next) => {
      if (context.agent === undefined) return next();
      try {
        await refreshTopicFromMessages(
          runtime,
          context.agent,
          humanMessages(context.agent),
          context.signal,
        );
        replaceSection(
          assembly,
          LITERATURE_SECTION,
          stateFor(runtime, context.agent).litBlock,
        );
      } catch (error) {
        await next();
        throw new Error('scholar-native: literature enrichment failed', { cause: error });
      }
      return next();
    },
    { prepend: true },
  );

  const disposeAudit = ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next();
    if (result.isError || exec.signal.aborted) return downstream;
    let audit;
    try {
      audit = auditWrittenFile(runtime, exec.name, exec.arguments, exec.signal);
    } catch (error) {
      return {
        kind: 'block',
        feedback: [{
          type: 'text',
          text: 'The academic file write completed, but its citation audit failed. Re-read the file and verify every citation before finishing.',
        }],
        ...downstream.additionalContexts === undefined
          ? {}
          : { additionalContexts: downstream.additionalContexts },
      };
    }
    if (audit.length === 0) return downstream;
    return {
      ...downstream,
      additionalContexts: [
        citationMessage(audit),
        ...downstream.additionalContexts ?? [],
      ],
    };
  });

  ctx.effect(() => () => {
    disposeAudit();
    disposeAssembly();
    disposeLiterature();
    disposeInterests();
    disposePersona();
  }, 'scholar-native: dispose prompt and tool contributions');
}
