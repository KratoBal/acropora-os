import { StyleSheet, Text, View, type TextStyle } from "react-native";

import { assistantBlocks, type AssistantSpan } from "@/lib/messages/assistant";

/**
 * SUTYERÁK SZÖVEGE A TELEFONON (4. pont, B): a webes `AssistantMarkdown`
 * szabályai (`assistantBlocks`), csak `Text`-ként. HTML, kép vagy hivatkozás
 * nem rajzolódik ki: ami nem félkövér, felsorolás vagy táblázat, sima szöveg.
 */
export function AssistantText({
  text,
  style,
}: {
  text: string;
  style: TextStyle;
}) {
  const line = (spans: AssistantSpan[]) =>
    spans.map((span, index) => (
      <Text key={index} style={span.bold ? styles.bold : undefined}>
        {span.text}
      </Text>
    ));
  return (
    <View style={styles.blocks}>
      {assistantBlocks(text).map((block, index) => {
        if (block.kind === "paragraph")
          return (
            <Text key={index} style={style} selectable>
              {line(block.spans)}
            </Text>
          );
        if (block.kind === "list")
          return (
            <View key={index} style={styles.blocks}>
              {block.items.map((item, position) => (
                <Text key={position} style={style} selectable>
                  {block.ordered ? `${position + 1}. ` : "• "}
                  {line(item)}
                </Text>
              ))}
            </View>
          );
        return (
          <View key={index} style={styles.table}>
            {[block.header, ...block.rows].map((row, rowIndex) => (
              <View key={rowIndex} style={styles.row}>
                {row.map((cell, cellIndex) => (
                  <Text
                    key={cellIndex}
                    style={[style, styles.cell, rowIndex === 0 && styles.bold]}
                    selectable
                  >
                    {line(cell)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  blocks: { gap: 4 },
  bold: { fontWeight: "700" },
  table: { borderWidth: StyleSheet.hairlineWidth, borderColor: "#c9d1d9" },
  row: { flexDirection: "row" },
  cell: {
    flex: 1,
    padding: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#c9d1d9",
  },
});
