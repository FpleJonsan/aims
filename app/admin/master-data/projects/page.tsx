"use client";

import { MasterDataManager } from "../_shared/MasterDataManager";

export default function ProjectsPage() {
  return <MasterDataManager apiPath="/admin/master-data/projects" label="Project" pluralLabel="Projects" />;
}
