# Perguntas para o gestor da Avic

Precisamos confirmar os pontos abaixo para importar e conferir os registros corretamente no Lume.

1. **Horários e fuso:** HoraSaidaGaragem, HoraChegadaGaragem e LastUpdate são enviados em UTC ou no horário local? Quando vêm sem Z/offset, qual fuso devemos aplicar? Isso é igual para todas as empresas e para o histórico? Envie um exemplo com o horário exibido no aplicativo e o JSON correspondente.
2. **Número da frota:** VeiculoFrota é exatamente o número usado pela empresa? Pode ter zeros à esquerda, letras ou ser reutilizado/trocado? É único por empresa? Como obter a relação completa entre número da frota, VeiculoId e placa?
3. **Filtro de veículo:** o parâmetro idveiculo aceita número da frota ou exige VeiculoId? Existe consulta por número da frota? Precisamos evitar que a pessoa tenha de preencher IDs técnicos no Lume.
4. **Identificador de cada viagem:** qual campo identifica uma viagem de forma única e permanente: RegistroViagemId, Id ou outro? Ele se mantém após correção, aprovação, cancelamento e reabertura? Uma viagem pode aparecer em mais de uma linha?
5. **Cobertura:** a consulta inclui todos os clientes, modalidades, viagens em andamento, concluídas, canceladas e deslocamentos de garagem? Há trechos fora dessa consulta que expliquem diferença entre os odômetros de viagens consecutivas?
6. **Leituras de KM:** o que representam exatamente KMSaidaGaragem, KMChegadaOrigem, KMChegadaDestino, KMSaidaDestino, KMRetorno e KMRetornoGaragem? Zero significa leitura real ou campo não preenchido? KMTotal é calculado ou informado? Como separar garagem e serviço?
7. **Correções e sequência:** LastUpdate muda em toda correção? É possível consultar registros alterados desde uma data? Como são sinalizados cancelamentos, exclusões e troca de veículo? Há horário ou sequência para ordenar duas viagens com o mesmo instante?
8. **Consulta por período:** viagemini e viagemfim incluem os dois limites? Filtram saída, chegada ou qualquer viagem que atravesse o período? Como obter viagens iniciadas antes do primeiro dia e encerradas dentro dele? Qual o limite de histórico?
9. **Paginação e disponibilidade:** a ordenação é estável enquanto novas viagens entram? Qual o sinal definitivo de fim das páginas? Quais limites de requisições e procedimento para indisponibilidade?
10. **Rota e contrato:** IdLinhaRota representa qual entidade? Permanece estável quando nome, cliente ou contrato mudam? Existe uma referência do contrato que possa ser vinculada explicitamente ao contrato do cliente no Lume?

## Distinções importantes

- **Frota identifica o veículo. Identificador da viagem identifica um registro.** A frota 120 pode fazer 30 viagens: usar apenas 120 como chave das viagens faria essas viagens disputarem o mesmo registro.
- **Limite contratado vem do contrato do cliente no Lume.** Confirme com a gestão interna a franquia, periodicidade diária/mensal, vigência e inclusão de garagem. Isso não é configuração da Avic e um contrato mensal não deve virar um limite por viagem.
- **Salto de odômetro é uma diferença entre viagens do mesmo veículo.** Se a viagem anterior terminou em 120.000 km e a seguinte começou em 120.035 km, existe um intervalo de 35 km a conferir. Pode ser garagem, abastecimento, viagem faltante ou digitação; não prova erro do motorista nem excesso de contrato. O limite opcional apenas destaca diferenças maiores. Sem sequência completa, o resultado exige contexto.
- O fuso da rotina diária do Lume é diferente do fuso dos horários recebidos. Nenhuma confirmação do provedor deve ser presumida a partir do horário do navegador ou da VPS.

Os nomes acima foram conferidos no adaptador atual do Lume. O significado e as garantias do provedor ainda precisam da resposta da Avic.
