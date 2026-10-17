import { describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import TaskRecurrenceSelect from "./TaskRecurrenceSelect.vue";

type RecurrenceRule = {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  weekdays?: number[];
};

// Host emulating the parent dialog's v-model: writes every emitted rule back
// into the prop, so the component's watch sees its own emissions exactly as
// in the real dialogs.
function mountHost(initial: RecurrenceRule | null = null) {
  const rule = ref<RecurrenceRule | null>(initial);
  const host = defineComponent({
    setup(_, { expose }) {
      expose({ rule });
      return () =>
        h(TaskRecurrenceSelect, {
          // undefined falls back to the prop's null default
          modelValue: rule.value ?? undefined,
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
});
