/**
 * OpenAI function schema 生成（Phase1.2）。
 *
 * 从工具声明的 parameters（ToolParameter，支持 enum/array/嵌套 object）自动生成
 * 发给模型的 function schema，避免各工具手工复制 properties 造成的漂移，
 * 并让 enum/嵌套信息真正到达模型（约束取值、降低自由发挥）。
 */
import { JsonSchemaProperty, ToolParameter, ToolSchema } from '../interfaces/tool.interface';

/** 递归把一个 ToolParameter 转成 JSON-Schema 属性 */
function toProperty(param: ToolParameter): JsonSchemaProperty {
  const property: JsonSchemaProperty = { type: param.type, description: param.description };
  if (param.enum) property.enum = param.enum;
  if (param.items) property.items = toProperty(param.items);
  if (param.properties) {
    property.properties = {};
    for (const [key, child] of Object.entries(param.properties)) {
      property.properties[key] = toProperty(child);
    }
  }
  return property;
}

/** 由 name/description/parameters 生成 function schema（required 由参数 required 提升） */
export function toFunctionSchema(
  name: string,
  description: string,
  parameters: Record<string, ToolParameter>,
): ToolSchema {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];
  for (const [key, param] of Object.entries(parameters)) {
    properties[key] = toProperty(param);
    if (param.required) required.push(key);
  }
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required },
    },
  };
}
