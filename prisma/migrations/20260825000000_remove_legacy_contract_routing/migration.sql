-- O roteirizador anterior nunca foi publicado em produção. Esta limpeza é
-- intencional e autorizada para ambientes de desenvolvimento/staging que
-- chegaram a executar as migrations experimentais removidas do repositório.
-- O cadastro compartilhado em routing_companies e seus vínculos é preservado.

DROP TABLE IF EXISTS "routing_navigation_links" CASCADE;
DROP TABLE IF EXISTS "routing_route_executions" CASCADE;
DROP TABLE IF EXISTS "routing_route_approvals" CASCADE;
DROP TABLE IF EXISTS "routing_route_versions" CASCADE;
DROP TABLE IF EXISTS "routing_route_history" CASCADE;
DROP TABLE IF EXISTS "routing_route_passengers" CASCADE;
DROP TABLE IF EXISTS "routing_route_points" CASCADE;
DROP TABLE IF EXISTS "routing_routes" CASCADE;

DROP TABLE IF EXISTS "routing_contract_history" CASCADE;
DROP TABLE IF EXISTS "routing_contract_shifts" CASCADE;
DROP TABLE IF EXISTS "routing_contract_cost_centers" CASCADE;
DROP TABLE IF EXISTS "routing_contracts" CASCADE;

DROP TABLE IF EXISTS "passenger_import_records" CASCADE;
DROP TABLE IF EXISTS "passenger_import_batches" CASCADE;
DROP TABLE IF EXISTS "passenger_history" CASCADE;
DROP TABLE IF EXISTS "passenger_issues" CASCADE;
DROP TABLE IF EXISTS "passenger_document_data" CASCADE;
DROP TABLE IF EXISTS "passengers" CASCADE;
DROP TABLE IF EXISTS "routing_fixed_points" CASCADE;

DROP TYPE IF EXISTS "RoutingFixedPointStatus";
DROP TYPE IF EXISTS "PassengerStatus";
DROP TYPE IF EXISTS "PassengerRegistrationStatus";
DROP TYPE IF EXISTS "RoutingDataOrigin";
DROP TYPE IF EXISTS "PassengerIssueStatus";
DROP TYPE IF EXISTS "PassengerImportBatchStatus";
DROP TYPE IF EXISTS "PassengerImportAction";
DROP TYPE IF EXISTS "RoutingRouteType";
DROP TYPE IF EXISTS "RoutingRouteStatus";
DROP TYPE IF EXISTS "RoutingDirection";
DROP TYPE IF EXISTS "RoutingAssignmentStatus";
DROP TYPE IF EXISTS "RoutingContractStatus";
DROP TYPE IF EXISTS "RoutingContractPeriodicity";
