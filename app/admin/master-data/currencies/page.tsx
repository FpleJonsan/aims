"use client";

import { MasterDataManager } from "../_shared/MasterDataManager";

export default function CurrenciesPage() {
  return <MasterDataManager apiPath="/admin/master-data/currencies" label="Currency" pluralLabel="Currencies" />;
}
