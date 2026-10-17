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
function mountHost(
  initial: RecurrenceRule | null = null,
  defaultMonthDay: number | null = null,
) {
  const rule = ref<RecurrenceRule | null>(initial);
  const host = defineComponent({
    setup(_, { expose }) {
      expose({ rule });
      return () =>
        h(TaskRecurrenceSelect, {
          // undefined falls back to the prop's null default
          modelValue: rule.value ?? undefined,
          defaultMonthDay: defaultMonthDay ?? undefined,
          "onUpdate:modelValue": (value: RecurrenceRule | null) => {
            rule.value = value;
          },
        });
    },
  });
  const wrapper = mount(host);
  return {
    wrapper,
    rule,
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

  const dayInput = (wrapper: Host["wrapper"]) =>
    wrapper.find('input[aria-label="Day of month"]');

  it("shows the day input seeded from defaultMonthDay on the monthly preset", async () => {
    const { wrapper, getRule } = mountHost(null, 15);

    await modeSelect(wrapper).setValue("monthly");
    expect(getRule()).toEqual({ frequency: "monthly", interval: 1 });
    expect(wrapper.find(".recurrence-monthday").exists()).toBe(true);
    expect((dayInput(wrapper).element as HTMLInputElement).value).toBe("15");
    expect(wrapper.find(".recurrence-weekdays").exists()).toBe(false);
  });

  it("emits monthDay when the day input changes and keeps the mode", async () => {
    const { wrapper, getRule } = mountHost(null, 15);

    await modeSelect(wrapper).setValue("monthly");
    await dayInput(wrapper).setValue(20);
    await dayInput(wrapper).trigger("change");
    expect(getRule()).toEqual({
      frequency: "monthly",
      interval: 1,
      monthDay: 20,
    });
    expect(modeSelect(wrapper).element.value).toBe("monthly");
    expect(wrapper.find(".recurrence-monthday").exists()).toBe(true);

    // Out-of-range values clamp into 1..31
    await dayInput(wrapper).setValue(32);
    await dayInput(wrapper).trigger("change");
    expect(getRule()).toEqual({
      frequency: "monthly",
      interval: 1,
      monthDay: 31,
    });
  });

  it("keeps Custom… selected with the day row when the custom unit is months", async () => {
    const { wrapper, getRule } = mountHost(null, 15);

    await modeSelect(wrapper).setValue("custom");
    await wrapper
      .find('select[aria-label="Repeat unit"]')
      .setValue("monthly");
    await wrapper
      .find('input[aria-label="Repeat every"]')
      .setValue(2);
    await wrapper
      .find('input[aria-label="Repeat every"]')
      .trigger("change");
    expect(getRule()).toEqual({ frequency: "monthly", interval: 2 });
    expect(modeSelect(wrapper).element.value).toBe("custom");
    expect(wrapper.find(".recurrence-custom").exists()).toBe(true);
    expect(wrapper.find(".recurrence-monthday").exists()).toBe(true);
    expect((dayInput(wrapper).element as HTMLInputElement).value).toBe("15");

    await dayInput(wrapper).setValue(10);
    await dayInput(wrapper).trigger("change");
    expect(getRule()).toEqual({
      frequency: "monthly",
      interval: 2,
      monthDay: 10,
    });
    expect(modeSelect(wrapper).element.value).toBe("custom");
  });

  it("seeds an external monthly rule without monthDay and re-derives the mode", async () => {
    // Rule saved before this feature: no monthDay — the day input falls
    // back to the seed and the mode still re-derives to the monthly preset
    const { wrapper, rule } = mountHost(
      { frequency: "monthly", interval: 1 },
      8,
    );
    expect(modeSelect(wrapper).element.value).toBe("monthly");
    expect((dayInput(wrapper).element as HTMLInputElement).value).toBe("8");

    rule.value = { frequency: "monthly", interval: 1, monthDay: 22 };
    await nextTick();
    expect((dayInput(wrapper).element as HTMLInputElement).value).toBe("22");
  });

  it("keeps a chosen monthDay when bouncing between the preset and Custom", async () => {
    const { wrapper, getRule } = mountHost(null, 15);

    await modeSelect(wrapper).setValue("monthly");
    await dayInput(wrapper).setValue(20);
    await dayInput(wrapper).trigger("change");
    expect(getRule()).toEqual({
      frequency: "monthly",
      interval: 1,
      monthDay: 20,
    });

    // Into Custom… (unit months): the day rides along
    await modeSelect(wrapper).setValue("custom");
    expect(getRule()).toEqual({
      frequency: "monthly",
      interval: 1,
      monthDay: 20,
    });
    expect(modeSelect(wrapper).element.value).toBe("custom");
    expect((dayInput(wrapper).element as HTMLInputElement).value).toBe("20");

    // Back to the monthly preset: the day survives
    await modeSelect(wrapper).setValue("monthly");
    expect(getRule()).toEqual({
      frequency: "monthly",
      interval: 1,
      monthDay: 20,
    });
    expect(modeSelect(wrapper).element.value).toBe("monthly");
  });

  it("re-seeds the day input when the seed prop changes for a rule without monthDay", async () => {
    // Picking monthly before the due date is filled seeds today's day;
    // when the due date is filled in afterwards, the seed follows the new
    // fallback day (the host re-renders with a changed defaultMonthDay)
    const seed = ref(17);
    const rule = ref<RecurrenceRule | null>(null);
    const wrapper = mount(
      defineComponent({
        setup() {
          return () =>
            h(TaskRecurrenceSelect, {
              modelValue: rule.value ?? undefined,
              defaultMonthDay: seed.value,
              "onUpdate:modelValue": (value: RecurrenceRule | null) => {
                rule.value = value;
              },
            });
        },
      }),
    );
    const day = () =>
      wrapper.find('input[aria-label="Day of month"]')
        .element as HTMLInputElement;
    const repeats = () => wrapper.find('select[aria-label="Repeats"]');

    await repeats().setValue("monthly");
    expect(rule.value).toEqual({ frequency: "monthly", interval: 1 });
    expect(day().value).toBe("17");

    seed.value = 5;
    await nextTick();
    expect(day().value).toBe("5");

    // An explicit monthDay is never overridden by a seed change
    await wrapper.find('input[aria-label="Day of month"]').setValue(20);
    await wrapper
      .find('input[aria-label="Day of month"]')
      .trigger("change");
    seed.value = 9;
    await nextTick();
    expect(day().value).toBe("20");
    expect(rule.value).toEqual({
      frequency: "monthly",
      interval: 1,
      monthDay: 20,
    });
  });
});
