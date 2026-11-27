System.register(["vue", "agui-bus"], function(exports, module) {
  "use strict";
  var defineComponent, computed, ref, onMounted, onUnmounted, openBlock, createElementBlock, Fragment, createElementVNode, renderList, normalizeClass, toDisplayString, normalizeStyle, createTextVNode, createCommentVNode, createApp, aguiBus;
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
      renderList = module2.renderList;
      normalizeClass = module2.normalizeClass;
      toDisplayString = module2.toDisplayString;
      normalizeStyle = module2.normalizeStyle;
      createTextVNode = module2.createTextVNode;
      createCommentVNode = module2.createCommentVNode;
      createApp = module2.createApp;
    }, (module2) => {
      aguiBus = module2.aguiBus;
    }],
    execute: function() {
      exports("mount", mount);
      const _hoisted_1 = { class: "chart-wrap" };
      const _hoisted_2 = ["aria-label", "onClick"];
      const _hoisted_3 = { class: "chart-val" };
      const _hoisted_4 = { class: "chart-labels" };
      const _hoisted_5 = { class: "chart-foot" };
      const _hoisted_6 = { key: 0 };
      const _hoisted_7 = { class: "w-ds" };
      const _hoisted_8 = {
        key: 0,
        class: "w-ds-loading"
      };
      const _hoisted_9 = {
        key: 1,
        class: "w-ds-error"
      };
      const _hoisted_10 = { key: 2 };
      const _hoisted_11 = { class: "w-busecho" };
      const _sfc_main = /* @__PURE__ */ defineComponent({
        __name: "ChartWidget",
        props: {
          data: {},
          ctx: {}
        },
        setup(__props) {
          const props = __props;
          const dataSource = computed(() => String(props.data.dataSource ?? "").replace(/\/+$/, ""));
          const DEFAULT_LABELS = ["周一", "周二", "周三", "周四", "周五"];
          const DEFAULT_SERIES = [
            [32, 58, 44, 76, 61],
            [20, 40, 66, 38, 52]
          ];
          function toStrArray(raw) {
            if (!Array.isArray(raw) || raw.length === 0) return null;
            return raw.map((v) => String(v));
          }
          function toSeries(raw) {
            if (!Array.isArray(raw) || raw.length === 0) return null;
            const out = [];
            for (const s of raw) {
              if (!Array.isArray(s)) return null;
              out.push(s.map((n) => Number(n) || 0));
            }
            return out;
          }
          const propsSeries = computed(() => {
            const s = props.data.series;
            if (Array.isArray(s) && Array.isArray(s[0]) && Array.isArray(s[1])) {
              return [s[0].map(Number), s[1].map(Number)];
            }
            return DEFAULT_SERIES;
          });
          const propsNames = computed(
            () => Array.isArray(props.data.names) ? props.data.names.map(String) : ["本周", "上周"]
          );
          const remote = ref(
            null
          );
          const loading = ref(false);
          const loadError = ref("");
          const labels = computed(
            () => {
              var _a;
              return ((_a = remote.value) == null ? void 0 : _a.labels) ?? (Array.isArray(props.data.labels) ? props.data.labels.map(String) : DEFAULT_LABELS);
            }
          );
          const series = computed(() => {
            var _a;
            return ((_a = remote.value) == null ? void 0 : _a.series) ?? propsSeries.value;
          });
          const names = computed(() => {
            var _a;
            return ((_a = remote.value) == null ? void 0 : _a.names) ?? propsNames.value;
          });
          let disposed = false;
          async function refresh() {
            if (!dataSource.value) return;
            loading.value = true;
            try {
              const range = typeof props.data.range === "string" && props.data.range ? `?range=${encodeURIComponent(props.data.range)}` : "";
              const res = await fetch(`${dataSource.value}${range}`, { headers: { Accept: "application/json" } });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const json = await res.json();
              if (disposed) return;
              remote.value = {
                labels: toStrArray(json.labels),
                names: toStrArray(json.names),
                series: toSeries(json.series)
              };
              loadError.value = "";
            } catch (e) {
              if (disposed) return;
              loadError.value = `实时数据拉取失败（${e.message}），已回退初始数据`;
            } finally {
              loading.value = false;
            }
          }
          const datasetIndex = ref(0);
          const activeBar = ref(null);
          const clickCount = ref(0);
          const busEcho = ref("等待交互…");
          let off = null;
          const values = computed(() => series.value[datasetIndex.value] ?? series.value[0]);
          const max = computed(() => Math.max(1, ...series.value.flat().map((n) => Number.isFinite(n) ? n : 0)));
          const datasetName = computed(() => names.value[datasetIndex.value] ?? `数据集 ${datasetIndex.value + 1}`);
          function clickBar(i) {
            activeBar.value = i;
            clickCount.value += 1;
            datasetIndex.value = (datasetIndex.value + 1) % Math.max(2, series.value.length);
            aguiBus.emit("widget_action", {
              type: "widget_action",
              app: "chart",
              value: `${labels.value[i] ?? i} · 切到「${names.value[datasetIndex.value] ?? datasetIndex.value}」`,
              slotId: props.ctx.slotId,
              label: "柱状图组件"
            });
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
              _cache[1] || (_cache[1] = createElementVNode("div", { class: "w-head" }, [
                createElementVNode("span", { class: "w-title" }, "迷你柱状图 · 点击柱子切换数据"),
                createElementVNode("span", { class: "w-tag" }, "System.register · chart")
              ], -1)),
              _cache[2] || (_cache[2] = createElementVNode("p", { class: "w-hint" }, "纯 CSS 柱状图，无图表库。点击任一柱子会切换数据集并回写 bus。", -1)),
              createElementVNode("div", _hoisted_1, [
                (openBlock(true), createElementBlock(Fragment, null, renderList(values.value, (v, i) => {
                  return openBlock(), createElementBlock("button", {
                    key: i,
                    class: normalizeClass(["chart-bar-slot", { "is-active": activeBar.value === i }]),
                    type: "button",
                    "aria-label": `${labels.value[i]} ${v}`,
                    onClick: ($event) => clickBar(i)
                  }, [
                    createElementVNode("span", _hoisted_3, toDisplayString(v), 1),
                    createElementVNode("span", {
                      class: "chart-bar",
                      style: normalizeStyle({ height: `${Math.round(v / max.value * 82)}%` })
                    }, null, 4)
                  ], 10, _hoisted_2);
                }), 128))
              ]),
              createElementVNode("div", _hoisted_4, [
                (openBlock(true), createElementBlock(Fragment, null, renderList(labels.value, (l, i) => {
                  return openBlock(), createElementBlock("span", { key: i }, toDisplayString(l), 1);
                }), 128))
              ]),
              createElementVNode("div", _hoisted_5, [
                _cache[0] || (_cache[0] = createTextVNode(" 当前数据集：", -1)),
                createElementVNode("strong", null, toDisplayString(datasetName.value), 1),
                createTextVNode(" · 累计点击 " + toDisplayString(clickCount.value) + " 次 ", 1),
                activeBar.value !== null ? (openBlock(), createElementBlock("span", _hoisted_6, " · 最近点击「" + toDisplayString(labels.value[activeBar.value]) + "」", 1)) : createCommentVNode("", true)
              ]),
              createElementVNode("div", _hoisted_7, [
                loading.value ? (openBlock(), createElementBlock("span", _hoisted_8, "实时数据加载中…")) : loadError.value ? (openBlock(), createElementBlock("span", _hoisted_9, "⚠ " + toDisplayString(loadError.value), 1)) : dataSource.value ? (openBlock(), createElementBlock("span", _hoisted_10, "实时数据源 · " + toDisplayString(labels.value.length) + " 个数据点 · 点击柱子切换数据集", 1)) : createCommentVNode("", true)
              ]),
              createElementVNode("div", _hoisted_11, "🔌 " + toDisplayString(busEcho.value), 1)
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
