declare const __payloadBrand: unique symbol;

export type PayloadSpec<P> = {
  readonly [__payloadBrand]: P;
};

export type ExtractPayload<S> = S extends PayloadSpec<infer P> ? P : unknown;

export function payload<P>(): PayloadSpec<P> {
  return { __declared: true } as unknown as PayloadSpec<P>;
}
