alter table public.invoice_line_items enable row level security;
drop policy if exists "invoice_line_items_select_parent_invoice" on public.invoice_line_items;
drop policy if exists "invoice_line_items_insert_parent_invoice" on public.invoice_line_items;
drop policy if exists "invoice_line_items_update_parent_invoice" on public.invoice_line_items;
drop policy if exists "invoice_line_items_delete_parent_invoice" on public.invoice_line_items;
create policy "invoice_line_items_select_parent_invoice"
on public.invoice_line_items
for select
using (
  exists (
    select 1
    from public.invoices
    where invoices.id = invoice_line_items.invoice_id
      and (
        invoices.user_id = auth.uid()
        or exists (
          select 1
          from public.users
          where users.id = auth.uid()
            and users.organization_id = invoices.organization_id
        )
      )
  )
);
create policy "invoice_line_items_insert_parent_invoice"
on public.invoice_line_items
for insert
with check (
  exists (
    select 1
    from public.invoices
    where invoices.id = invoice_line_items.invoice_id
      and (
        invoices.user_id = auth.uid()
        or exists (
          select 1
          from public.users
          where users.id = auth.uid()
            and users.organization_id = invoices.organization_id
        )
      )
  )
);
create policy "invoice_line_items_update_parent_invoice"
on public.invoice_line_items
for update
using (
  exists (
    select 1
    from public.invoices
    where invoices.id = invoice_line_items.invoice_id
      and (
        invoices.user_id = auth.uid()
        or exists (
          select 1
          from public.users
          where users.id = auth.uid()
            and users.organization_id = invoices.organization_id
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.invoices
    where invoices.id = invoice_line_items.invoice_id
      and (
        invoices.user_id = auth.uid()
        or exists (
          select 1
          from public.users
          where users.id = auth.uid()
            and users.organization_id = invoices.organization_id
        )
      )
  )
);
create policy "invoice_line_items_delete_parent_invoice"
on public.invoice_line_items
for delete
using (
  exists (
    select 1
    from public.invoices
    where invoices.id = invoice_line_items.invoice_id
      and (
        invoices.user_id = auth.uid()
        or exists (
          select 1
          from public.users
          where users.id = auth.uid()
            and users.organization_id = invoices.organization_id
        )
      )
  )
);
