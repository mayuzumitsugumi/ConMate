import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CustomFieldInput from "../../src/ui/components/CustomFieldInput.vue";
import type { CustomField } from "../../src/domain/models/catalog";

function field(
  type: CustomField["type"],
  options: CustomField["options"] = [],
): CustomField {
  return {
    id: "field-1",
    workspaceId: "workspace-1",
    code: "FLD-000001",
    name: "自訂欄位",
    type,
    options,
    archived: false,
  };
}

describe("CustomFieldInput", () => {
  it("emits null, false, and true for the three boolean choices", async () => {
    const wrapper = mount(CustomFieldInput, {
      props: { field: field("boolean"), modelValue: null },
    });
    const select = wrapper.get("select");

    await select.setValue("");
    await select.setValue("false");
    await select.setValue("true");

    expect(wrapper.emitted("update:modelValue")).toEqual([
      [null],
      [false],
      [true],
    ]);
  });

  it("emits numeric zero and emits null when the number input is cleared", async () => {
    const wrapper = mount(CustomFieldInput, {
      props: { field: field("number"), modelValue: null },
    });
    const input = wrapper.get('input[type="number"]');

    await input.setValue("0");
    await input.setValue("");

    expect(wrapper.emitted("update:modelValue")).toEqual([[0], [null]]);
  });

  it("keeps an archived selected option and does not offer archived options for new selection", async () => {
    const wrapper = mount(CustomFieldInput, {
      props: {
        field: field("multi", [
          { id: "old-option", label: "舊標記", archived: true },
          { id: "new-option", label: "新標記", archived: false },
          { id: "other-archived", label: "停用標記", archived: true },
        ]),
        modelValue: ["old-option"],
      },
    });
    const [oldOption, newOption, otherArchivedOption] = wrapper.findAll(
      'input[type="checkbox"]',
    );

    expect((oldOption.element as HTMLInputElement).checked).toBe(true);
    expect((oldOption.element as HTMLInputElement).disabled).toBe(true);
    expect(otherArchivedOption).toBeUndefined();

    await newOption.setValue(true);

    expect(wrapper.emitted("update:modelValue")).toEqual([
      [["old-option", "new-option"]],
    ]);
  });
});
