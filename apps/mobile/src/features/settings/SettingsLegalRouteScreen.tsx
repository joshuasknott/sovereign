import { useNavigation } from "@react-navigation/native";
import { T, useGT } from "gt-react-native";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { SettingsLegalDocumentRouteScreen } from "./components/SettingsLegalDocumentRouteScreen";
import { LEGAL_URL } from "./lib/legal-document-url";

export function SettingsLegalRouteScreen() {
  const gt = useGT();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  if (LEGAL_URL !== null) {
    return (
      <SettingsLegalDocumentRouteScreen
        documentName={gt("Legal", { $context: "legal documents page title" })}
        documentUrl={LEGAL_URL}
      />
    );
  }

  return (
    <View className="flex-1 bg-sheet">
      <SheetHeader
        title={gt("Legal", { $context: "legal documents page title" })}
        accessibilityLabel={gt("Close legal document")}
        onClose={() => navigation.goBack()}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <View className="gap-3 rounded-[24px] border-continuous bg-grouped-card p-5">
          <Text className="font-t3-bold text-lg text-foreground">
            <T>License and Attribution</T>
          </Text>
          <Text className="text-sm leading-normal text-foreground-muted">
            <T>
              Sovereign is an independent open-source project built upon T3 Code (MIT License,
              Copyright (c) 2026 T3 Tools Inc.). Sovereign is not affiliated with, endorsed by, or
              maintained by T3 Tools, Inc.
            </T>
          </Text>
          <Text className="text-sm leading-normal text-foreground-muted">
            <T>
              Third-party license notices are available in Settings under About and Open source
              licenses.
            </T>
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
