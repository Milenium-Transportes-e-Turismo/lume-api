/**
 * Fronteira reservada ao futuro OR-Tools. Nenhuma heurística fictícia é
 * registrada como implementação enquanto o problema de otimização não estiver
 * especificado (capacidades, janelas, garagem, acessibilidade e matriz).
 */
export abstract class RouteOptimizationProvider<TInput, TOutput> {
  abstract optimize(input: TInput): Promise<TOutput>;
}
