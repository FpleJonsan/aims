"use client";

import { MasterDataManager } from "../_shared/MasterDataManager";

export default function CategoriesPage() {
  return <MasterDataManager apiPath="/admin/master-data/categories" label="Category" pluralLabel="Categories" />;
}
