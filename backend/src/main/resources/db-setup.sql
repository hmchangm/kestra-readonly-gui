CREATE TABLE IF NOT EXISTS executions (
    `key`         VARCHAR(250) NOT NULL PRIMARY KEY,
    `value`       CLOB,
    deleted       BOOLEAN DEFAULT FALSE,
    id            VARCHAR(100) NOT NULL,
    namespace     VARCHAR(150) NOT NULL,
    flow_id       VARCHAR(150) NOT NULL,
    state_current VARCHAR(50)  NOT NULL,
    start_date    TIMESTAMP,
    end_date      TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kestra_retrigger_audit (
    id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
    triggered_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    triggered_by          VARCHAR(255) NOT NULL,
    original_execution_id VARCHAR(255) NOT NULL,
    new_execution_id      VARCHAR(255) NOT NULL,
    input_overrides       TEXT NULL
);
