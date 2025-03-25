export type Rule<
    State extends unknown,
    Request extends unknown
> = {
    name: string;
    check: (state: State, request: Request) => boolean | undefined;
}