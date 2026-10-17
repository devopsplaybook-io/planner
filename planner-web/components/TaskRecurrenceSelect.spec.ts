import { describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import TaskRecurrenceSelect from "./TaskRecurrenceSelect.vue";

type RecurrenceRule = {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  weekdays?: number[];
  monthDay?: number;
};

// Host emulating the parent dialog's v-model: writes every emitted rule back
// into the prop, so the component's watch sees its own emissions exactly as
// in the real dialogs.
function mountHost(initial: RecurrenceRule | null = null, dueDate = "") {
  const rule = ref<RecurrenceRule | null>(initial);
  const aligned = ref<string | null>(null);
  const host = defineComponent({
    setup(_, { expose }) {
      expose({ rule });
      return () =>
        h(TaskRecurrenceSelect, {
          // undefined falls back to the prop's null default
          modelValue: rule.value ?? undefined,
          dueDate,
          "onUpdate:modelValue": (value: RecurrenceRule | null) => {
            rule.value = value;
          },
          onAlign: (date: string) => {
            aligned.value = date;
          },
        });
    },
  });
  const wrapper = mount(host);
  return {
    wrapper,
    rule,
    aligned,
    getRule: () => rule.value,
  };
}

type Host = ReturnType<typeof mountHost>;

const chips = (wrapper: Host["wrapper"]) =>
  wrapper.findAll("button.recurrence-weekday");
const chipFor = (wrapper: Host["wrapper"], label: string) => {
  const chip = chips(wrapper).find((c) => c.text() === label);
  if (!chip) throw new Error(`weekday chip ${label} not found`);
  return chip;
};
const modeSelect = (wrapper: Host["wrapper"]) => wrapper.find("select");
const daySelect = (wrapper: Host["wrapper"]) =>
  wrapper.find('select[aria-label="Day of month"]');

describe("TaskRecurrenceSelect", () => {
  it("emits preset rules and null for Does not repeat", async () => {
    const { wrapper, getRule } = mountHost();

    await modeSelect(wrapper).setValue("daily");
    expect(getRule()).toEqual({ frequency: "daily", interval: 1 });
    expect(modeSelect(wrapper).element.value).toBe("daily");

    await modeSelect(wrapper).setValue("monthly");
    expect(getRule()).toEqual({ frequency: "monthly", interval: 1 });
    expect(modeSelect(wrapper).element.value).toBe("monthly");

    await modeSelect(wrapper).setValue("none");
    expect(getRule()).toBeNull();
    expect(modeSelect(wrapper).element.value).toBe("none");
  });

  it("toggles weekday chips from the weekly preset", async () => {
    const { wrapper, getRule } = mountHost();

    await modeSelect(wrapper).setValue("weekly");
    expect(chips(wrapper)).toHaveLength(7);
    expect(chipFor(wrapper, "Mon").attributes("aria-pressed")).toBe("false");

    await chipFor(wrapper, "Mon").trigger("click");
    expect(getRule()).toEqual({
      frequency: "weekly",
      interval: 1,
      weekdays: [1],
    });
    expect(chipFor(wrapper, "Mon").attributes("aria-pressed")).toBe("true");
    expect(chipFor(wrapper, "Mon").classes()).toContain("is-on");
    expect(modeSelect(wrapper).element.value).toBe("weekly");

    await chipFor(wrapper, "Mon").trigger("click");
    expect(getRule()).toEqual({ frequency: "weekly", interval: 1 });
    expect(chipFor(wrapper, "Mon").attributes("aria-pressed")).toBe("false");
  });

  it("keeps Custom… selected after choosing it (mode bounce regression)", async () => {
    const { wrapper, getRule } = mountHost();

    await modeSelect(wrapper).setValue("custom");
    expect(getRule()).toEqual({ frequency: "daily", interval: 1 });
    expect(modeSelect(wrapper).element.value).toBe("custom");
    expect(wrapper.find(".recurrence-custom").exists()).toBe(true);
  });

  it("shows weekday chips inside Custom when the unit is weeks", async () => {
    const { wrapper, getRule } = mountHost();

    await modeSelect(wrapper).setValue("custom");
    await wrapper
      .find('select[aria-label="Repeat unit"]')
      .setValue("weekly");
    expect(getRule()).toEqual({ frequency: "weekly", interval: 1 });
    expect(wrapper.find(".recurrence-custom").exists()).toBe(true);
    expect(modeSelect(wrapper).element.value).toBe("custom");
    expect(chips(wrapper)).toHaveLength(7);

    await chipFor(wrapper, "Mon").trigger("click");
    expect(getRule()).toEqual({
      frequency: "weekly",
      interval: 1,
      weekdays: [1],
    });
    expect(wrapper.find(".recurrence-custom").exists()).toBe(true);
    expect(modeSelect(wrapper).element.value).toBe("custom");
  });

  it("keeps chip state when switching from the weekly preset to Custom", async () => {
    const { wrapper, getRule } = mountHost({
      frequency: "weekly",
      interval: 1,
      weekdays: [1, 5],
    });
    expect(chipFor(wrapper, "Mon").attributes("aria-pressed")).toBe("true");

    await modeSelect(wrapper).setValue("custom");
    expect(getRule()).toEqual({
      frequency: "weekly",
      interval: 1,
      weekdays: [1, 5],
    });
    expect(modeSelect(wrapper).element.value).toBe("custom");
    expect(wrapper.find(".recurrence-custom").exists()).toBe(true);
    const unitSelect = wrapper.find(
      'select[aria-label="Repeat unit"]',
    ).element as HTMLSelectElement;
    expect(unitSelect.value).toBe("weekly");
    expect(chipFor(wrapper, "Mon").attributes("aria-pressed")).toBe("true");
    expect(chipFor(wrapper, "Fri").attributes("aria-pressed")).toBe("true");
  });

  it("re-derives the mode when the parent changes the rule", async () => {
    const { wrapper, rule } = mountHost({
      frequency: "weekly",
      interval: 1,
      weekdays: [1],
    });
    expect(modeSelect(wrapper).element.value).toBe("weekly");

    // Edit-mode seed with interval > 1 lands on Custom…
    rule.value = { frequency: "weekly", interval: 2 };
    await nextTick();
    expect(modeSelect(wrapper).element.value).toBe("custom");
    const intervalInput = wrapper.find(
      'input[aria-label="Repeat every"]',
    ).element as HTMLInputElement;
    expect(intervalInput.value).toBe("2");

    // Dialog reset to a fresh preset rule re-derives the preset
    rule.value = { frequency: "monthly", interval: 1 };
    await nextTick();
    expect(modeSelect(wrapper).element.value).toBe("monthly");
  });

  it("shows the day-of-month selector for monthly rules", async () => {
    const { wrapper } = mountHost();
    expect(daySelect(wrapper).exists()).toBe(false);

    await modeSelect(wrapper).setValue("monthly");
    expect(daySelect(wrapper).exists()).toBe(true);
    expect(
      daySelect(wrapper).findAll("option").map((o) => o.text()),
    ).toContain("Same day as the due date");
    expect(
      daySelect(wrapper).findAll("option").map((o) => o.text()),
    ).toContain("Last day");
    expect(
      daySelect(wrapper).findAll("option").map((o) => o.text()),
    ).toContain("15th");
    // absent monthDay keeps the "Same day" option selected
    expect((daySelect(wrapper).element as HTMLSelectElement).value).toBe("");

    await modeSelect(wrapper).setValue("weekly");
    expect(daySelect(wrapper).exists()).toBe(false);
  });

  it("emits, strips and re-derives the monthDay", async () => {
    const { wrapper, getRule } = mountHost();

    await modeSelect(wrapper).setValue("monthly");
    await daySelect(wrapper).setValue("15");
    expect(getRule()).toEqual({ frequency: "monthly", interval: 1, monthDay: 15 });
    expect((daySelect(wrapper).element as HTMLSelectElement).value).toBe("15");

    await daySelect(wrapper).setValue("31");
    expect(getRule()).toEqual({ frequency: "monthly", interval: 1, monthDay: 31 });

    // "Same day as the due date" removes the monthDay again
    await daySelect(wrapper).setValue("");
    expect(getRule()).toEqual({ frequency: "monthly", interval: 1 });
    expect((daySelect(wrapper).element as HTMLSelectElement).value).toBe("");

    // switching to daily or weekly strips the monthDay
    await daySelect(wrapper).setValue("15");
    expect(getRule()).toEqual({ frequency: "monthly", interval: 1, monthDay: 15 });
    await modeSelect(wrapper).setValue("daily");
    expect(getRule()).toEqual({ frequency: "daily", interval: 1 });
    await modeSelect(wrapper).setValue("weekly");
    expect(getRule()).toEqual({ frequency: "weekly", interval: 1 });
  });

  it("re-derives the selector from a parent-seeded rule", async () => {
    const { wrapper } = mountHost({
      frequency: "monthly",
      interval: 1,
      monthDay: 20,
    });
    expect(modeSelect(wrapper).element.value).toBe("monthly");
    expect((daySelect(wrapper).element as HTMLSelectElement).value).toBe("20");
  });

  it("keeps the monthDay in Custom… across interval changes", async () => {
    const { wrapper, getRule } = mountHost({
      frequency: "monthly",
      interval: 1,
      monthDay: 15,
    });

    await modeSelect(wrapper).setValue("custom");
    expect(getRule()).toEqual({
      frequency: "monthly",
      interval: 1,
      monthDay: 15,
    });

    const intervalInput = wrapper.find('input[aria-label="Repeat every"]');
    await intervalInput.setValue("3");
    await intervalInput.trigger("change");
    expect(getRule()).toEqual({
      frequency: "monthly",
      interval: 3,
      monthDay: 15,
    });

    // switching the custom unit away from months drops it
    await wrapper.find('select[aria-label="Repeat unit"]').setValue("weekly");
    expect(getRule()).toEqual({ frequency: "weekly", interval: 3 });
    expect(daySelect(wrapper).exists()).toBe(false);
  });

  it("offers to align the due date when it does not match the picked day", async () => {
    const { wrapper, getRule, aligned } = mountHost(null, "2026-10-16");

    await modeSelect(wrapper).setValue("monthly");
    expect(wrapper.find(".recurrence-monthday small").exists()).toBe(false);
    expect(wrapper.find("button.recurrence-align").exists()).toBe(false);

    await daySelect(wrapper).setValue("15");
    expect(getRule()).toEqual({ frequency: "monthly", interval: 1, monthDay: 15 });
    const hint = wrapper.find(".recurrence-monthday small");
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain("the 15th");

    await wrapper.find("button.recurrence-align").trigger("click");
    expect(aligned.value).toBe("2026-11-15");
  });

  it("offers no alignment when the monthDay is absent or already aligned", async () => {
    const alignedWrapper = mountHost(null, "2026-10-15");
    await modeSelect(alignedWrapper.wrapper).setValue("monthly");
    await daySelect(alignedWrapper.wrapper).setValue("15");
    // Oct 15 already matches the picked day
    expect(alignedWrapper.aligned.value).toBeNull();
    expect(
      alignedWrapper.wrapper.find("button.recurrence-align").exists(),
    ).toBe(false);

    const noDayWrapper = mountHost(null, "2026-10-16");
    await modeSelect(noDayWrapper.wrapper).setValue("monthly");
    expect(
      noDayWrapper.wrapper.find("button.recurrence-align").exists(),
    ).toBe(false);
  });

  it("aligns a 'Last day' rule within the due date's month", async () => {
    const { wrapper, aligned } = mountHost(null, "2026-10-16");

    await modeSelect(wrapper).setValue("monthly");
    await daySelect(wrapper).setValue("31");
    await wrapper.find("button.recurrence-align").trigger("click");
    expect(aligned.value).toBe("2026-10-31");
  });
});
