/**
 * Mulqi Better Harness — bundled skill provider.
 *
 * Serves the canonical `better-harness` skill into the DSH global skills
 * layer at the custom-skill rank, so every session on the profile sees it
 * regardless of the active preset. The catalog text is derived from the
 * shipped SKILL.md at read time: editing the doctrine updates the catalog
 * in lockstep, and the two can never disagree.
 *
 * Fail-closed: any frontmatter shape this provider cannot read exactly is
 * dropped with a warning, never published truncated. Node builtins only.
 */

import { readFile } from 'node:fs/promises'
import { watch } from 'node:fs'

export const PROVIDER_NAME = 'mulqi-better-harness'

/** The canonical skill this bundle publishes. */
export const SKILL_NAME = 'better-harness'

/**
 * Mirrors the rank the DSH filesystem provider assigns to custom skill
 * directories, so a bundle-registered canonical skill sits exactly where
 * the documented manual route would put it.
 */
export const CUSTOM_SKILL_RANK = 300

const TRUTHY = new Set(['true', 'yes', 'on', '1'])
const FALSY = new Set(['false', 'no', 'off', '0'])
const INVOCATION_KEYS = ['disable-model-invocation', 'user-invocable']

/**
 * Parse the frontmatter subset this skill uses: plain or quoted scalars
 * between `---` fences, plus folded/literal block values. Indented nested
 * maps and unknown block styles are reported as unsupported so the skill
 * is dropped with a reason instead of published mis-read.
 *
 * @param {string} raw full SKILL.md text.
 * @returns {{ fields: Record<string,string>, body: string, unsupported: string[] }|undefined}
 * `undefined` when the file is not frontmatter-shaped at all.
 */
export function parseFrontmatter(raw) {
  const text = String(raw ?? '')
  const firstBreak = text.indexOf('\n')
  if (firstBreak < 0 || text.slice(0, firstBreak).replace(/\r$/, '') !== '---') return undefined

  const fields = {}
  const unsupported = []
  let body = ''
  let pos = firstBreak + 1
  let closed = false

  while (pos <= text.length) {
    const nextBreak = text.indexOf('\n', pos)
    const lineEnd = nextBreak < 0 ? text.length : nextBreak
    const line = text.slice(pos, lineEnd).replace(/\r$/, '')
    if (line === '---') {
      closed = true
      break
    }
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (match) {
      let value = match[2].trim()
      let posAfter = nextBreak < 0 ? text.length + 1 : nextBreak + 1
      if (value.startsWith('>') || value.startsWith('|')) {
        // Folded/literal block: consume the indented (or empty) lines that
        // follow and join them into one string.
        const block = []
        let i = posAfter
        while (i <= text.length) {
          const bEnd = i >= text.length ? i : text.indexOf('\n', i)
          const bLineEnd = bEnd < 0 ? text.length : bEnd
          const bLine = text.slice(i, bLineEnd).replace(/\r$/, '')
          if (bLine.trim() === '' || /^\s/.test(bLine)) {
            block.push(bLine.trim())
            i = bEnd < 0 ? text.length + 1 : bEnd + 1
          } else {
            break
          }
        }
        value = block.join(' ').trim()
        posAfter = i
        if (value === '') unsupported.push(match[1])
      }
      value = value.replace(/^["']/, '').replace(/["']$/, '')
      if (value === 'null' || value === '~' || value.startsWith('[') || value.startsWith('{')) {
        unsupported.push(match[1])
        value = ''
      }
      fields[match[1]] = value
      pos = posAfter
      continue
    }
    if (/^\s/.test(line) && line.trim() !== '') {
      // Indented continuation of a key this parser did not collect.
      const lastKey = Object.keys(fields).pop()
      if (lastKey !== undefined && fields[lastKey] !== '' && !unsupported.includes(lastKey)) {
        unsupported.push(lastKey)
      }
    }
    pos = nextBreak < 0 ? text.length + 1 : nextBreak + 1
  }
  if (!closed) return undefined
  const bodyStart = text.indexOf('\n', pos)
  body = bodyStart < 0 ? '' : text.slice(bodyStart + 1)
  return { fields, body, unsupported }
}

/**
 * Derive the invocation policy from the boolean vocabulary DSH accepts
 * (`true/false/yes/no/on/off/1/0`), defaulting to both surfaces enabled.
 * @returns {{ invocation: object, invalidKeys: string[] }}
 */
export function deriveInvocation(fields) {
  const invalidKeys = []
  const parse = (key) => {
    if (!Object.hasOwn(fields, key)) return undefined
    const raw = String(fields[key]).toLowerCase()
    if (TRUTHY.has(raw)) return true
    if (FALSY.has(raw)) return false
    invalidKeys.push(key)
    return null
  }
  const disabled = parse('disable-model-invocation')
  const user = parse('user-invocable')
  return {
    invocation: {
      modelInvocable: disabled !== true,
      userInvocable: user !== false,
    },
    invalidKeys,
  }
}

/**
 * Build the provider instance for `ctx.skills.registerProvider`.
 *
 * @param {object} paths `{ skillDirectory, skillFile }` canonical paths.
 * @param {object} [options] `logger` receives fail-closed warnings; `rank`
 *   overrides the custom rank when a host precedence table moves.
 * @returns {object} a DSH SkillProvider.
 */
export function makeProvider(paths, { logger, rank = CUSTOM_SKILL_RANK } = {}) {
  const rankValue = Number.isFinite(rank) ? rank : CUSTOM_SKILL_RANK
  const warn = (message) => {
    if (typeof logger?.warn === 'function') logger.warn(`mulqi-better-harness: ${message}`)
  }

  async function load(signal) {
    let raw
    try {
      raw = await readFile(paths.skillFile, { encoding: 'utf8', signal })
    } catch (error) {
      if (error?.code === 'ABORT_ERR' || error?.name === 'AbortError' || signal?.aborted) return undefined
      warn(`cannot read ${paths.skillFile}: ${error?.message ?? error}`)
      return undefined
    }
    const parsed = parseFrontmatter(raw)
    if (parsed === undefined) {
      warn(`${paths.skillFile} has no parsable YAML frontmatter; the skill is not published`)
      return undefined
    }
    const { fields, body, unsupported } = parsed
    if (fields.name !== SKILL_NAME) {
      warn(`${paths.skillFile} declares name ${JSON.stringify(fields.name)}, expected ${JSON.stringify(SKILL_NAME)}`)
      return undefined
    }
    if (typeof fields.description !== 'string' || fields.description.length === 0) {
      warn(`${paths.skillFile} declares no description; the skill is not published`)
      return undefined
    }
    if (unsupported.length > 0) {
      warn(`${paths.skillFile} uses frontmatter this provider does not parse (${unsupported.join(', ')}); the skill is not published`)
      return undefined
    }
    const { invocation, invalidKeys } = deriveInvocation(fields)
    if (invalidKeys.length > 0) {
      warn(`${paths.skillFile} has invalid invocation frontmatter (${invalidKeys.join(', ')}); the skill is not published`)
      return undefined
    }
    const whenToUse = typeof fields.whenToUse === 'string' && fields.whenToUse.length > 0 ? fields.whenToUse : undefined
    return {
      name: fields.name,
      description: fields.description,
      ...(whenToUse !== undefined ? { whenToUse } : {}),
      invocation,
      content: body.trim(),
    }
  }

  function toCandidate(loaded) {
    return {
      name: loaded.name,
      description: loaded.description,
      ...(loaded.whenToUse !== undefined ? { whenToUse: loaded.whenToUse } : {}),
      invocation: loaded.invocation,
      source: 'custom',
      provider: PROVIDER_NAME,
      path: paths.skillFile,
      resourceBase: { kind: 'directory', path: paths.skillDirectory },
      rank: rankValue,
      locator: null,
    }
  }

  return {
    name: PROVIDER_NAME,
    async list(options = {}) {
      const loaded = await load(options.signal)
      if (loaded === undefined) return []
      return [toCandidate(loaded)]
    },
    async get(candidate, options = {}) {
      if (candidate?.name !== SKILL_NAME) return undefined
      const loaded = await load(options.signal)
      if (loaded === undefined) return undefined
      return {
        ...toCandidate(loaded),
        content: loaded.content,
        rank: undefined,
        locator: undefined,
      }
    },
  }
}

/**
 * Invalidate the skills catalog when the canonical SKILL.md changes.
 * Watches the directory (not the file) so installers that replace the
 * inode keep working. Debounced 200 ms; closes on abort or watcher error.
 *
 * @param {object} control the DSH registration control (`signal`, `invalidate`).
 * @param {object} paths `{ skillDirectory }` canonical paths.
 * @param {object} [logger] host logger for watcher warnings.
 * @returns {() => void} disposer.
 */
export function watchSkillRoot(control, paths, logger) {
  let timer
  let watcher
  try {
    watcher = watch(paths.skillDirectory, { persistent: false }, (_event, filename) => {
      if (filename !== null && filename !== undefined && filename !== 'SKILL.md') return
      clearTimeout(timer)
      timer = setTimeout(() => {
        try {
          control.invalidate()
        } catch {
          /* registration already disposed */
        }
      }, 200)
    })
    watcher.on('error', (error) => {
      if (typeof logger?.warn === 'function') {
        logger.warn(`mulqi-better-harness: skill watcher error: ${error?.message ?? error}`)
      }
      try { watcher.close() } catch { /* already closed */ }
    })
  } catch (error) {
    if (typeof logger?.warn === 'function') {
      logger.warn(`mulqi-better-harness: skill watcher unavailable: ${error?.message ?? error}`)
    }
    return () => {}
  }
  const stop = () => {
    clearTimeout(timer)
    try { watcher?.close() } catch { /* already closed */ }
  }
  if (control.signal?.aborted) {
    stop()
    return stop
  }
  control.signal?.addEventListener?.('abort', stop, { once: true })
  return stop
}

export { INVOCATION_KEYS }
