System.register(["vue", "agui-bus"], function(exports, module) {
  "use strict";
  var defineComponent, computed, ref, onMounted, onUnmounted, openBlock, createElementBlock, Fragment, createElementVNode, withDirectives, withKeys, vModelText, toDisplayString, createCommentVNode, createApp, aguiBus;
  return {
    setters: [(module2) => {
      defineComponent = module2.defineComponent;
      computed = module2.computed;
      ref = module2.ref;
      onMounted = module2.onMounted;
      onUnmounted = module2.onUnmounted;
      openBlock = module2.openBlock;
      createElementBlock = module2.createElementBlock;
      Fragment = module2.Fragment;
      createElementVNode = module2.createElementVNode;
      withDirectives = module2.withDirectives;
      withKeys = module2.withKeys;
      vModelText = module2.vModelText;
      toDisplayString = module2.toDisplayString;
      createCommentVNode = module2.createCommentVNode;
      createApp = module2.createApp;
    }, (module2) => {
      aguiBus = module2.aguiBus;
    }],
    execute: function() {
      exports("mount", mount);
      const _hoisted_1 = { class: "form-row" };
      const _hoisted_2 = ["placeholder"];
      const _hoisted_3 = ["disabled"];
      const _hoisted_4 = { class: "form-feedback" };
      const _hoisted_5 = { key: 0 };
      const _hoisted_6 = { key: 1 };
      const _hoisted_7 = { class: "w-ds" };
      const _hoisted_8 = {
        key: 0,
        class: "w-ds-error"
      };
      const _hoisted_9 = { key: 1 };
      const _hoisted_10 = { key: 2 };
      const _hoisted_11 = { key: 3 };
      const _sfc_main = /* @__PURE__ */ defineComponent({
        __name: "FormWidget",
        props: {
          data: {},
          ctx: {}
        },
        setup(__props) {
          const props = __props;
          const dataSource = computed(() => String(props.data.dataSource ?? "").replace(/\/+$/, ""));
          const remotePlaceholder = ref("");
          const placeholder = computed(() => {
            const fromProps = props.data.placeholder;
            if (typeof fromProps === "string" && fromProps.trim()) return fromProps;
            if (remotePlaceholder.value) return remotePlaceholder.value;
            return "输入点什么…";
          });
          let disposed = false;
          async function refresh() {
            if (!dataSource.value) return;
            try {
              const res = await fetch(dataSource.value, { headers: { Accept: "application/json" } });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const json = await res.json();
              if (disposed) return;
              if (typeof json.placeholder === "string") remotePlaceholder.value = json.placeholder;
            } catch {
            }
          }
          const draft = ref("");
          const submitted = ref("");
          const charCount = ref(0);
          const submitting = ref(false);
          const submitError = ref("");
          const echo = ref("");
          let off = null;
          async function submit() {
            var _a;
            const value = draft.value.trim();
            if (!value) return;
            submitted.value = value;
            aguiBus.emit("widget_action", {
              type: "widget_action",
              app: "form",
              value,
              slotId: props.ctx.slotId,
              label: "表单组件"
            });
            if (!dataSource.value || submitting.value) return;
            submitting.value = true;
            submitError.value = "";
            try {
              const res = await fetch(dataSource.value, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ value })
              });
              const json = await res.json().catch(() => null);
              if (res.ok && (json == null ? void 0 : json.ok)) {
                echo.value = ((_a = json.echo) == null ? void 0 : _a.value) ?? value;
              } else {
                submitError.value = `提交失败：${(json == null ? void 0 : json.error) ?? `HTTP ${res.status}`}`;
              }
            } catch (e) {
              submitError.value = `提交请求失败：${e.message}`;
            } finally {
              submitting.value = false;
            }
          }
          onMounted(() => {
            off = aguiBus.on("widget_action", (e) => {
              charCount.value = e.value.length;
            });
            props.ctx.trace("bus-bind", 'aguiBus.on("widget_action") 已注册（基座单例）');
            void refresh();
          });
          onUnmounted(() => {
            disposed = true;
            off == null ? void 0 : off();
          });
          return (_ctx, _cache) => {
            return openBlock(), createElementBlock(Fragment, null, [
              _cache[1] || (_cache[1] = createElementVNode("div", { class: "w-head" }, [
                createElementVNode("span", { class: "w-title" }, "交互表单 · 输入 + 提交"),
                createElementVNode("span", { class: "w-tag" }, "System.register · form")
              ], -1)),
              _cache[2] || (_cache[2] = createElementVNode("p", { class: "w-hint" }, "先输入几个字，等后面的 markdown 继续吐完，回头看输入框内容还在不在。", -1)),
              createElementVNode("div", _hoisted_1, [
                withDirectives(createElementVNode("input", {
                  "onUpdate:modelValue": _cache[0] || (_cache[0] = ($event) => draft.value = $event),
                  class: "form-input",
                  type: "text",
                  placeholder: placeholder.value,
                  onKeyup: withKeys(submit, ["enter"])
                }, null, 40, _hoisted_2), [
                  [vModelText, draft.value]
                ]),
                createElementVNode("button", {
                  class: "form-btn",
                  type: "button",
                  disabled: !draft.value.trim() || submitting.value,
                  onClick: submit
                }, toDisplayString(submitting.value ? "提交中…" : "提交"), 9, _hoisted_3)
              ]),
              createElementVNode("div", _hoisted_4, [
                submitted.value ? (openBlock(), createElementBlock("span", _hoisted_5, "✅ 已提交：" + toDisplayString(submitted.value) + "（输入状态仍保留在上方输入框）", 1)) : (openBlock(), createElementBlock("span", _hoisted_6, "输入框当前 " + toDisplayString(draft.value.length) + " 个字符 · bus 最近回写长度 " + toDisplayString(charCount.value), 1))
              ]),
              createElementVNode("div", _hoisted_7, [
                submitError.value ? (openBlock(), createElementBlock("span", _hoisted_8, "⚠ " + toDisplayString(submitError.value), 1)) : echo.value ? (openBlock(), createElementBlock("span", _hoisted_9, "服务端回显：" + toDisplayString(echo.value), 1)) : submitting.value ? (openBlock(), createElementBlock("span", _hoisted_10, "提交中…")) : dataSource.value ? (openBlock(), createElementBlock("span", _hoisted_11, "实时数据源 · 提交后服务端原样回显")) : createCommentVNode("", true)
              ])
            ], 64);
          };
        }
      });
      function mount(container, props, ctx) {
        const app = createApp(_sfc_main, {
          data: props,
          ctx: { ...ctx, bus: ctx.bus ?? aguiBus }
        });
        app.mount(container);
        return { unmount: () => app.unmount() };
      }
    }
  };
});
