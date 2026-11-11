export type MaybePromise<T> = T | Promise<T>;

export type DocumentSource = {
  readonly name: string;
  readonly load?: (...ids: string[]) => MaybePromise<unknown>;
  readonly loadMany?: (
    paths: readonly (readonly string[])[],
  ) => MaybePromise<readonly unknown[]>;
};

export type RelatedSource = {
  readonly id: string;
  readonly load: (
    doc: unknown,
    ...ids: string[]
  ) => MaybePromise<readonly unknown[]>;
};

export interface Loader {
  document(source: DocumentSource, ids: readonly string[]): Promise<unknown>;
  related(
    source: RelatedSource,
    doc: unknown,
    ids: readonly string[],
  ): Promise<readonly unknown[]>;
  seedDocument(
    source: DocumentSource,
    ids: readonly string[],
    doc: unknown,
  ): void;
  seedRelated(
    source: RelatedSource,
    ids: readonly string[],
    rows: readonly unknown[],
  ): void;
  counters(): Readonly<Record<string, number>>;
}

type Waiting = {
  readonly ids: readonly string[];
  readonly resolve: (doc: unknown) => void;
  readonly reject: (error: unknown) => void;
};

type Scheduler = (flush: () => void) => void;

const SEPARATOR = "::";

const immediate = (
  globalThis as { readonly setImmediate?: (callback: () => void) => unknown }
).setImmediate;

const afterMicrotasks: Scheduler =
  typeof immediate === "function"
    ? (flush) => void immediate(flush)
    : (flush) => void setTimeout(flush, 0);

function keyOf(scope: string, ids: readonly string[]): string {
  return `${scope}${SEPARATOR}${ids.join(SEPARATOR)}`;
}

export function createLoader(schedule: Scheduler = afterMicrotasks): Loader {
  const documents = new Map<string, Promise<unknown>>();
  const relatedRows = new Map<string, Promise<readonly unknown[]>>();
  const loads = new Map<string, number>();
  const batches = new Map<DocumentSource, Waiting[]>();

  async function flush(
    source: DocumentSource,
    loadMany: NonNullable<DocumentSource["loadMany"]>,
    batch: readonly Waiting[],
  ): Promise<void> {
    try {
      const docs = await loadMany(batch.map((waiting) => waiting.ids));
      if (docs.length !== batch.length) {
        throw new Error(
          `loadMany of entity "${source.name}" returned ${docs.length} documents for ${batch.length} paths`,
        );
      }
      for (const [index, waiting] of batch.entries()) {
        waiting.resolve(docs[index] ?? null);
      }
    } catch (error) {
      for (const waiting of batch) waiting.reject(error);
    }
  }

  function enqueue(
    source: DocumentSource,
    loadMany: NonNullable<DocumentSource["loadMany"]>,
    ids: readonly string[],
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const open = batches.get(source);
      if (open) {
        open.push({ ids, resolve, reject });
        return;
      }
      const batch: Waiting[] = [{ ids, resolve, reject }];
      batches.set(source, batch);
      schedule(() => {
        batches.delete(source);
        void flush(source, loadMany, batch);
      });
    });
  }

  async function loadOne(
    source: DocumentSource,
    ids: readonly string[],
  ): Promise<unknown> {
    return (await source.load?.(...ids)) ?? null;
  }

  return {
    document(source, ids) {
      const key = keyOf(source.name, ids);
      const known = documents.get(key);
      if (known) return known;
      loads.set(source.name, (loads.get(source.name) ?? 0) + 1);
      const pending = source.loadMany
        ? enqueue(source, source.loadMany, ids)
        : loadOne(source, ids);
      documents.set(key, pending);
      return pending;
    },

    related(source, doc, ids) {
      const key = keyOf(source.id, ids);
      const known = relatedRows.get(key);
      if (known) return known;
      const pending = Promise.resolve(source.load(doc, ...ids));
      relatedRows.set(key, pending);
      return pending;
    },

    seedDocument(source, ids, doc) {
      documents.set(keyOf(source.name, ids), Promise.resolve(doc));
    },

    seedRelated(source, ids, rows) {
      relatedRows.set(keyOf(source.id, ids), Promise.resolve(rows));
    },

    counters: () => Object.fromEntries(loads),
  };
}
