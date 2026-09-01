# Políticas de Negócio

Este contexto mantém parâmetros de tipos previstos pelo produto sem permitir a
criação arbitrária de novas regras executáveis.

## Linguagem

**Tipo de Política**:
Estrutura conhecida pelo produto para preço, custo, aprovação, comunicação ou
outra decisão configurável.
_Evite_: Regra arbitrária, script

**Versão da Política**:
Retrato imutável dos parâmetros aprovados para uma política.
_Evite_: Configuração sobrescrita

**Vigência**:
Período no qual uma versão da política pode decidir novas operações.
_Evite_: Data de edição

**Política Aplicada**:
Versão efetivamente usada em uma decisão, preservada junto ao resultado para
que alterações futuras não o recalculem.
_Evite_: Política atual

**Exceção de Política**:
Desvio autorizado segundo a matriz de aprovação, com motivo e responsável.
_Evite_: Edição manual sem rastreabilidade
