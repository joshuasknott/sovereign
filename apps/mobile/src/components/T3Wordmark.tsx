import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  return (
    <Svg
      accessibilityLabel="Sovereign"
      height={props.height}
      width={props.height}
      viewBox="0 0 128 128"
    >
      <ThemedPath
        d="M42 20H100L85 35H49L41 43L49 51H70L55 66H41L26 51V36L42 20Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
      <ThemedPath
        d="M86 108H28L43 93H79L87 85L79 77H58L73 62H87L102 77V92L86 108Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
