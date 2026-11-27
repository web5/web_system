System.register(["vue", "agui-bus"], function(exports, module) {
  "use strict";
  var defineComponent, computed, ref, onMounted, onUnmounted, openBlock, createElementBlock, Fragment, createElementVNode, toDisplayString, renderList, normalizeClass, createTextVNode, createCommentVNode, createApp, aguiBus;
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
      toDisplayString = module2.toDisplayString;
      renderList = module2.renderList;
      normalizeClass = module2.normalizeClass;
      createTextVNode = module2.createTextVNode;
      createCommentVNode = module2.createCommentVNode;
      createApp = module2.createApp;
    }, (module2) => {
      aguiBus = module2.aguiBus;
    }],
    execute: function() {
      exports("mount", mount);
      const _hoisted_1 = { class: "w-head" };
      const _hoisted_2 = { class: "w-title" };
      const _hoisted_3 = { class: "poll-options" };
      const _hoisted_4 = ["disabled", "onClick"];
      const _hoisted_5 = {
        key: 0,
        class: "poll-votes"
      };
      const _hoisted_6 = { class: "poll-feedback" };
      const _hoisted_7 = { key: 0 };
      const _hoisted_8 = { key: 1 };
      const _hoisted_9 = { class: "w-ds" };
      const _hoisted_10 = {
        key: 0,
        class: "w-ds-loading"
      };
      const _hoisted_11 = {
        key: 1,
        class: "w-ds-error"
      };
      const _hoisted_12 = {
        key: 2,
        class: "w-ds-error"
      };
      const _hoisted_13 = { key: 3 };
      const _hoisted_14 = { class: "w-busecho" };
      const _sfc_main = /* @__PURE__ */ defineComponent({
        __name: "PollWidget",
        props: {
          data: {},
          ctx: {}
        },
        setup(__props) {
          const props = __props;
          const dataSource = computed(() => String(props.data.dataSource ?? "").replace(/\/+$/, ""));
          function toOptions(raw) {
            if (!Array.isArray(raw)) return [];
            return raw.map((o, i) => {
              if (o && typeof o === "object") {
                const rec = o;
                return {
                  id: String(rec.id ?? `opt_${i}`),
                  label: String(rec.label ?? `选项 ${i + 1}`),
                  votes: Number(rec.votes) || 0
                };
              }
              return { id: `opt_${i}`, label: String(o), votes: 0 };
            });
          }
          const fallbackOptions = computed(() => toOptions(props.data.options));
          const remote = ref(null);
          const loading = ref(false);
          const loadError = ref("");
          const question = computed(() => {
            var _a;
            const fromProps = props.data.question;
            if (typeof fromProps === "string" && fromProps.trim()) return fromProps;
            const fromRemote = (_a = remote.value) == null ? void 0 : _a.question;
            if (typeof fromRemote === "string" && fromRemote.trim()) return fromRemote;
            return "请选择一个选项";
          });
          const options = computed(
            () => {
              var _a, _b;
              return ((_b = (_a = remote.value) == null ? void 0 : _a.options) == null ? void 0 : _b.length) ? remote.value.options : fallbackOptions.value;
            }
          );
          const totalVotes = computed(
            () => {
              var _a;
              return ((_a = remote.value) == null ? void 0 : _a.total) ?? fallbackOptions.value.reduce((s, o) => s + o.votes, 0);
            }
          );
          let disposed = false;
          async function refresh() {
            if (!dataSource.value) return;
            loading.value = true;
            try {
              const res = await fetch(dataSource.value, { headers: { Accept: "application/json" } });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const json = await res.json();
              if (disposed) return;
              remote.value = {
                question: typeof json.question === "string" ? json.question : void 0,
                options: toOptions(json.options),
                total: typeof json.total === "number" ? json.total : void 0
              };
              loadError.value = "";
            } catch (e) {
              if (disposed) return;
              loadError.value = `实时数据拉取失败（${e.message}），已回退初始数据`;
            } finally {
              loading.value = false;
            }
          }
          const selectedId = ref(null);
          const totalClicks = ref(0);
          const voting = ref(false);
          const voteError = ref("");
          const busEcho = ref("等待交互…");
          let off = null;
          const selectedLabel = computed(
            () => {
              var _a;
              return ((_a = options.value.find((o) => o.id === selectedId.value)) == null ? void 0 : _a.label) ?? "";
            }
          );
          async function choose(opt) {
            selectedId.value = opt.id;
            totalClicks.value += 1;
            aguiBus.emit("widget_action", {
              type: "widget_action",
              app: "poll",
              value: opt.label,
              slotId: props.ctx.slotId,
              label: "投票组件"
            });
            if (!dataSource.value || voting.value) return;
            voting.value = true;
            voteError.value = "";
            try {
              const res = await fetch(`${dataSource.value}/vote`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ optionId: opt.id })
              });
              const json = await res.json().catch(() => null);
              if (res.ok && (json == null ? void 0 : json.ok)) {
                await refresh();
              } else {
                voteError.value = `投票未计入：${(json == null ? void 0 : json.error) ?? `HTTP ${res.status}`}`;
              }
            } catch (e) {
              voteError.value = `投票请求失败：${e.message}`;
            } finally {
              voting.value = false;
            }
          }
          onMounted(() => {
            off = aguiBus.on("widget_action", (e) => {
              busEcho.value = `bus 收到：${e.app} / ${e.value}`;
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
              createElementVNode("div", _hoisted_1, [
                createElementVNode("span", _hoisted_2, toDisplayString(question.value), 1),
                _cache[0] || (_cache[0] = createElementVNode("span", { class: "w-tag" }, "System.register · poll", -1))
              ]),
              _cache[2] || (_cache[2] = createElementVNode("p", { class: "w-hint" }, "点击任一选项 —— 会经 aguiBus 回写到消息流，并在下方立刻出现系统消息。", -1)),
              createElementVNode("div", _hoisted_3, [
                (openBlock(true), createElementBlock(Fragment, null, renderList(options.value, (opt) => {
                  return openBlock(), createElementBlock("button", {
                    key: opt.id,
                    class: normalizeClass(["poll-opt", { "is-selected": selectedId.value === opt.id }]),
                    type: "button",
                    disabled: voting.value,
                    onClick: ($event) => choose(opt)
                  }, [
                    createTextVNode(toDisplayString(selectedId.value === opt.id ? "✓ " : "") + toDisplayString(opt.label) + " ", 1),
                    totalVotes.value > 0 ? (openBlock(), createElementBlock("span", _hoisted_5, " · " + toDisplayString(opt.votes) + " 票", 1)) : createCommentVNode("", true)
                  ], 10, _hoisted_4);
                }), 128))
              ]),
              createElementVNode("div", _hoisted_6, [
                selectedId.value ? (openBlock(), createElementBlock("span", _hoisted_7, [
                  _cache[1] || (_cache[1] = createTextVNode("已选择：", -1)),
                  createElementVNode("strong", null, toDisplayString(selectedLabel.value), 1),
                  createTextVNode(" · 累计点击 " + toDisplayString(totalClicks.value) + " 次（后续 token 不会清空）", 1)
                ])) : (openBlock(), createElementBlock("span", _hoisted_8, "尚未选择 · 试着点一下，再观察后面的文字继续逐字吐出"))
              ]),
              createElementVNode("div", _hoisted_9, [
                loading.value ? (openBlock(), createElementBlock("span", _hoisted_10, "实时数据加载中…")) : loadError.value ? (openBlock(), createElementBlock("span", _hoisted_11, "⚠ " + toDisplayString(loadError.value), 1)) : voteError.value ? (openBlock(), createElementBlock("span", _hoisted_12, "⚠ " + toDisplayString(voteError.value), 1)) : dataSource.value ? (openBlock(), createElementBlock("span", _hoisted_13, "实时数据源 · 总票数 " + toDisplayString(totalVotes.value), 1)) : createCommentVNode("", true)
              ]),
              createElementVNode("div", _hoisted_14, "🔌 " + toDisplayString(busEcho.value), 1)
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
