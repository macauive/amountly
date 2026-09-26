-- Optimistic edit conflicts are permanent for the supplied version. SQLSTATE
-- 40001 is reserved for serialization failures and can trigger repeated
-- transaction retries in PostgREST. PT409 returns an immediate HTTP conflict.
do $$
declare signature text; definition text;
begin
  foreach signature in array array[
    'amountly_private.save_invoice(uuid,jsonb,jsonb,timestamp with time zone)',
    'amountly_private.invoice_action(uuid,text,timestamp with time zone)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    execute replace(definition, '''40001''', '''PT409''');
  end loop;
end $$;
