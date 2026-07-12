-- Kaiten estimate_workload бывает дробным (например 44.5) — integer не подходит.
-- Переименование убирает и ложное указание на единицы измерения.
alter table kaiten.cards rename column estimate_minutes to estimate_workload;
alter table kaiten.cards alter column estimate_workload type numeric(10,2);
