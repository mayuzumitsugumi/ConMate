import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import BarcodePicker from "../../src/ui/components/BarcodePicker.vue";
import type { CatalogItem } from "../../src/domain/models/catalog";
it("scanner Enter never auto-selects an ambiguous barcode or submits a sale", async () => {
  const products = [
    { id: "a", code: "SKU1", name: "first", barcode: "001", archived: false },
    { id: "b", code: "SKU2", name: "second", barcode: "001", archived: false },
  ] as CatalogItem[];
  const wrapper = mount(BarcodePicker, { props: { products } });
  await wrapper.get("input").setValue("001");
  await wrapper.get("input").trigger("keydown.enter");
  expect(wrapper.text()).toContain("多項符合");
  expect(wrapper.emitted("select")).toBeUndefined();
  await wrapper.findAll("button")[2]!.trigger("click");
  expect(wrapper.emitted("select")![0]).toEqual([products[1]]);
});
it("requires a visible choice for a unique match and resets results on new input", async () => {
  const products = [
    { id: "a", code: "SKU1", name: "first", barcode: "001", archived: false },
  ] as CatalogItem[];
  const wrapper = mount(BarcodePicker, { props: { products } });
  await wrapper.get("input").setValue("001");
  await wrapper.get("input").trigger("keydown.enter");
  expect(wrapper.text()).toContain("找到商品");
  expect(wrapper.emitted("select")).toBeUndefined();
  await wrapper.get("input").setValue("missing");
  expect(wrapper.text()).not.toContain("找到商品");
});
