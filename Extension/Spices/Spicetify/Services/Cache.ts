// Spicetify Services
import { IsDevelopment } from "./Session.ts"

// Configuration Types
export type ExpirationSettings = {
	Duration: number;
	Unit: "Days";
}

// Instant Store Types
type InstantStoreItems = Record<string, unknown>
type InstantStore = {
	Version: number;
	Items: InstantStoreItems;
}

// Instant Store
type InstantStoreInterface<Items> = {
	Items: Items;
	SaveChanges: () => void;
}

const RetrievedInstantStores: Set<string> = new Set()
export const GetInstantStore = <InstantStoreTemplate extends InstantStoreItems>(
	storeName: string, version: number,
	template: InstantStoreTemplate,
	forceNewData?: true
): Readonly<InstantStoreInterface<InstantStoreTemplate>> => {
	// Make sure we can't get the same store twice
	if (RetrievedInstantStores.has(storeName)) {
		throw new Error(`Can't retrieve InstantStore (${storeName}) twice.`)
	}
	RetrievedInstantStores.add(storeName)

	// Retrieve our store
	let store: InstantStore = (undefined as unknown as InstantStore)
	{
		if ((IsDevelopment === false) || (forceNewData === undefined)) {
			const serializedStore = localStorage.getItem(storeName)
			if (serializedStore !== null) {
				const parsedStore = JSON.parse(serializedStore) as InstantStore
				if (parsedStore.Version === version) {
					store = parsedStore
				}
			}
		}

		if (store === undefined) {
			store = {
				Version: version,
				Items: JSON.parse(JSON.stringify(template))
			}
		} else {
			const templateChecks: [Record<string, unknown>, Record<string, unknown>, string][] = [[store, template, storeName]]
			while (templateChecks.length > 0) {
				const [check, against, path] = templateChecks.pop()!
				for (const key in against) {
					const checkValue = check[key]
					const againstValue = against[key]
					if (checkValue === undefined) {
						check[key] = JSON.parse(JSON.stringify(againstValue))
					} else {
						const checkValueType = typeof checkValue
						if (checkValueType !== (typeof againstValue)) {
							throw new Error(`Template Type mismatch for "${`${path}.${key}`}"`)
						} else if (checkValueType === "object") {
							templateChecks.push(
								[
									checkValue as Record<string, unknown>,
									againstValue as Record<string, unknown>,
									`${path}.${key}`
								]
							)
						}
					}
				}
			}
		}
	}

	// Finally, return our public interface
	return Object.freeze(
		{
			Items: store.Items as InstantStoreTemplate,
			SaveChanges: () => localStorage.setItem(storeName, JSON.stringify(store))
		}
	)
}

// Dynamic Store
export const GetDynamicStoreItem = <I>(storeName: string, itemName: string): (I | undefined) => (
	(localStorage.getItem(`${storeName}:${itemName}`) as unknown as I)
	?? undefined
)
export const SetDynamicStoreItem = (storeName: string, itemName: string, content: string): void => (
	localStorage.setItem(`${storeName}:${itemName}`, content)
)

// Expire stores register policy only. IO starts with an explicit operation,
// never while importing this module.
const Day = 86_400_000
const Stores = new Map<string, { Version: number; Cap: number; Generation: number;
	Validate: (content: unknown) => boolean; Pending: Promise<unknown> }>()
const WarnedWrites = new Set<string>()
const MemoryStores = new Map<string, { Count: () => number; Clear: () => number }>()
const enqueue = <T>(store: { Pending: Promise<unknown> }, action: () => Promise<T>): Promise<T> => {
	const job = store.Pending.catch(() => {}).then(action)
	store.Pending = job
	return job
}
const validEnvelope = (value: any, version: number, validate: (content: unknown) => boolean) => (
	value !== null && typeof value === "object" && Number.isFinite(value.ExpiresAt)
	&& value.CacheVersion === version && Object.prototype.hasOwnProperty.call(value, "Content")
	&& (value.StoredAt === undefined || Number.isFinite(value.StoredAt)) && validate(value.Content)
)

export const GetExpireStore = <ItemType>(
	storeName: string, version: number, itemExpirationSettings: ExpirationSettings,
	forceNewData?: true, validate: (content: unknown) => boolean = content => content === false || (!!content && typeof content === "object"),
	cap = 2000
) => {
	const store = Stores.get(storeName) ?? { Version: version, Cap: cap, Generation: 0, Validate: validate, Pending: Promise.resolve() }
	Stores.set(storeName, store)
	// Compare bytes in the write queue: a slow corrupt read must not delete a
	// newer valid result. Invalid-entry cleanup never delays provider fetching.
	const discard = (key: RequestInfo, serialized: string, generation: number) => {
		void enqueue(store, async () => {
			if (generation !== store.Generation) return
			const cache = await caches.open(storeName)
			const current = await cache.match(key)
			if (current && await current.text() === serialized) await cache.delete(key)
		}).catch(() => {})
	}
	return Object.freeze({
		GetGeneration: () => store.Generation,
		GetItem: async (itemName: string): Promise<ItemType | undefined> => {
			if (IsDevelopment && forceNewData) return undefined
			const generation = store.Generation
			let serialized: string | undefined
			try {
				const response = await (await caches.open(storeName)).match('/' + itemName)
				if (!response) return undefined
				serialized = await response.text()
				const item = JSON.parse(serialized)
				if (!validEnvelope(item, version, validate) || item.ExpiresAt <= Date.now()) {
					discard('/' + itemName, serialized, generation)
					return undefined
				}
				return generation === store.Generation ? item.Content : undefined
			} catch {
				if (serialized !== undefined) discard('/' + itemName, serialized, generation)
				return undefined
			}
		},
		SetItem: async (itemName: string, content: ItemType, generation = store.Generation): Promise<ItemType> => {
			try {
				await enqueue(store, async () => {
					if (generation !== store.Generation) return
					const cache = await caches.open(storeName)
					if (generation !== store.Generation) return
					const now = Date.now()
					await cache.put('/' + itemName, new Response(JSON.stringify({
						StoredAt: now, ExpiresAt: now + (content === false ? 1 : itemExpirationSettings.Duration) * Day,
						CacheVersion: version, Content: content
					}), { headers: { 'Content-Type': 'application/json' } }))
				})
			} catch {
				if (!WarnedWrites.has(storeName)) {
					WarnedWrites.add(storeName)
					console.warn(`Failed to Update Cache API (${storeName})`)
				}
			}
			return content
		}
	})
}

export const RegisterMemoryCache = (name: string, cache: { Count: () => number; Clear: () => number }) => MemoryStores.set(name, cache)
export const GetMemoryStore = <T>(name: string, capacity: number) => {
	const items = new Map<string, T>()
	let generation = 0
	const store = {
		GetGeneration: () => generation,
		GetItem: (key: string) => {
			const value = items.get(key)
			if (value !== undefined) { items.delete(key); items.set(key, value) }
			return value
		},
		SetItem: (key: string, value: T, started = generation) => {
			if (started !== generation) return value
			items.delete(key)
			items.set(key, value)
			if (items.size > capacity) items.delete(items.keys().next().value!)
			return value
		},
		Count: () => items.size,
		Clear: () => { const count = items.size; ++generation; items.clear(); return count }
	}
	RegisterMemoryCache(name, store)
	return store
}
export const CountCacheEntries = async (names: readonly string[]) => {
	const counts: Record<string, number | undefined> = {}
	let existing: string[] | undefined
	try { existing = await caches.keys() } catch { /* Report unavailable counts. */ }
	for (const name of names) {
		const memory = MemoryStores.get(name)
		try { counts[name] = memory ? memory.Count() : existing ? (existing.includes(name) ? (await (await caches.open(name)).keys()).length : 0) : undefined }
		catch { counts[name] = undefined }
	}
	return counts
}
export const ClearCacheEntries = async (names: readonly string[]) => {
	// Invalidate every selected scope synchronously before the first await.
	for (const name of names) { const store = Stores.get(name); if (store) ++store.Generation }
	let removed = 0
	let failed = false
	// Memory generations must also advance before disk IO yields to lookups.
	for (const name of names) { const memory = MemoryStores.get(name); if (memory) removed += memory.Clear() }
	for (const name of names) {
		if (MemoryStores.has(name)) continue
		const store = Stores.get(name)
		if (!store) continue
		let count = 0
		try {
			await enqueue(store, async () => {
				if (!(await caches.keys()).includes(name)) return
				const cache = await caches.open(name)
				for (const key of await cache.keys()) if (await cache.delete(key)) ++count
			})
		} catch { failed = true }
		removed += count
	}
	return { removed, failed }
}
export const ClearCacheItems = async (entries: readonly { store: string; keys: readonly string[] }[]) => {
	// Same invalidation as ClearCacheEntries, before the first await. Memory
	// stores are never touched; only the named keys are deleted.
	for (const entry of entries) { const store = Stores.get(entry.store); if (store) ++store.Generation }
	let removed = 0
	let failed = false
	for (const entry of entries) {
		const store = Stores.get(entry.store)
		if (!store) continue
		let count = 0
		try {
			await enqueue(store, async () => {
				if (!(await caches.keys()).includes(entry.store)) return
				const cache = await caches.open(entry.store)
				for (const key of entry.keys) if (await cache.delete('/' + key)) ++count
			})
		} catch { failed = true }
		removed += count
	}
	return { removed, failed }
}

const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0))
export const SweepExpireStores = async (yieldWork: () => Promise<void> = yieldTask, isCancelled = () => false, now = () => performance.now()) => {
	// Cache keys are in insertion order for legacy entries without StoredAt.
	// Hits never extend eviction age. Writes have short individual queue slots;
	// scanning and yielding never hold up a provider's storage operation.
	let taskStartedAt = now()
	const yieldIfNeeded = async () => {
		// Entry sizes vary greatly. Bound each batch by elapsed time rather than
		// a fixed count; one JSON parse/validation is necessarily indivisible.
		if (now() - taskStartedAt >= 4) {
			await yieldWork()
			taskStartedAt = now()
		}
	}
	for (const [name, store] of Stores) {
		if (isCancelled()) return
		try {
			if (!(await caches.keys()).includes(name)) continue
			const generation = store.Generation
			const cache = await caches.open(name)
			// Retain only eviction metadata, not every valid song's serialized
			// body. Re-read candidates in the write queue to protect replacements.
			const live: { key: Request; storedAt?: number; expiresAt: number; order: number }[] = []
			const remove = (key: Request, unchanged: (serialized: string) => boolean) => enqueue(store, async () => {
				if (generation !== store.Generation || isCancelled()) return
				const current = await cache.match(key)
				if (!current) return
				const serialized = await current.text()
				if (generation !== store.Generation || isCancelled()) return
				if (unchanged(serialized)) await cache.delete(key)
			})
			let order = 0
			for (const key of await cache.keys()) {
				if (isCancelled() || generation !== store.Generation) break
				const response = await cache.match(key)
				if (isCancelled() || generation !== store.Generation) break
				if (!response) { await yieldIfNeeded(); continue }
				const serialized = await response.text()
				if (isCancelled() || generation !== store.Generation) break
				let item: any
				try { item = JSON.parse(serialized) } catch { /* Delete unreadable records. */ }
				let valid = false
				try { valid = validEnvelope(item, store.Version, store.Validate) && item.ExpiresAt > Date.now() } catch { /* Invalid content. */ }
				if (valid) live.push({ key, storedAt: item.StoredAt, expiresAt: item.ExpiresAt, order })
				else await remove(key, current => current === serialized)
				++order
				await yieldIfNeeded()
			}
			if (isCancelled()) return
			if (generation !== store.Generation) continue
			live.sort((a, b) => (a.storedAt ?? 0) - (b.storedAt ?? 0) || a.order - b.order)
			await yieldIfNeeded()
			for (const entry of live.slice(0, Math.max(0, live.length - store.Cap))) {
				if (isCancelled()) return
				if (generation !== store.Generation) break
				await remove(entry.key, serialized => {
					try {
						const current = JSON.parse(serialized)
						return current.CacheVersion === store.Version && current.StoredAt === entry.storedAt && current.ExpiresAt === entry.expiresAt
					} catch { return false }
				})
				await yieldIfNeeded()
			}
		} catch { /* Maintenance must never affect lyric loading. */ }
		await yieldWork()
		taskStartedAt = now()
	}
}

let maintenanceStarted = false
export const StartCacheMaintenance = () => {
	if (maintenanceStarted) return () => {}
	maintenanceStarted = true
	let cancelled = false
	let idle: number | undefined
	const timer = setTimeout(() => {
		const run = async () => {
			if (cancelled) return
			try {
				// Existence is the migration marker; subsequent sessions do not
				// delete or recreate the retired store.
				if ((await caches.keys()).includes('BeautifulLyricsLocal_Transformed')) await caches.delete('BeautifulLyricsLocal_Transformed')
			} catch { /* Retry next session if storage is unavailable. */ }
			await SweepExpireStores(yieldTask, () => cancelled)
		}
		if (typeof requestIdleCallback === 'function') idle = requestIdleCallback(() => { void run() })
		else void run()
	}, 60_000)
	return () => {
		cancelled = true
		clearTimeout(timer)
		if (idle !== undefined) cancelIdleCallback(idle)
	}
}
