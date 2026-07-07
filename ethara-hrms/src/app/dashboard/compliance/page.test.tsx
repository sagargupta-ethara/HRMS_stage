import { beforeEach, describe, expect, it, vi } from "vitest";

import { candidatesApi, complianceApi, employeesApi } from "@/lib/api";
import { fetchComplianceGroups } from "./page";

vi.mock("@/lib/api", () => ({
  candidatesApi: {
    list: vi.fn(),
  },
  complianceApi: {
    list: vi.fn(),
  },
  employeesApi: {
    listComplianceQueue: vi.fn(),
  },
}));

describe("fetchComplianceGroups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches every page of signed-contract candidates for the compliance queue", async () => {
    vi.mocked(candidatesApi.list).mockImplementation(async (params = {}) => {
      if (params.stage === "contract_signed" && params.page === 1) {
        return {
          data: [{ id: "cand-contract-1", fullName: "Signed Candidate 1", currentStage: "contract_signed" }],
          totalPages: 2,
        };
      }
      if (params.stage === "contract_signed" && params.page === 2) {
        return {
          data: [{ id: "cand-contract-2", fullName: "Signed Candidate 2", currentStage: "contract_signed" }],
          totalPages: 2,
        };
      }
      return { data: [], totalPages: 1 };
    });
    vi.mocked(complianceApi.list).mockResolvedValue([]);
    vi.mocked(employeesApi.listComplianceQueue).mockResolvedValue([]);

    const groups = await fetchComplianceGroups();

    expect(groups.map((group) => group.entityId)).toEqual(["cand-contract-1", "cand-contract-2"]);
    expect(candidatesApi.list).toHaveBeenCalledWith({ stage: "contract_signed", page: 1, limit: 200 });
    expect(candidatesApi.list).toHaveBeenCalledWith({ stage: "contract_signed", page: 2, limit: 200 });
  });
});
