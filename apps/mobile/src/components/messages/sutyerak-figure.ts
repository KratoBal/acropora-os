/**
 * Sutyerák figurája a telefonon (4. pont, B): ugyanaz a kép, mint a webes
 * widgetben (`apps/web/public/sutyerak/v2`). Helyi asset, hogy hálózat nélkül is
 * kirajzolódjon; ha a web képei cserélődnek, ez a kettő is.
 */
export const SUTYERAK_FIGURE = {
  resting: require("../../../assets/images/sutyerak/pihen.png") as number,
  thinking:
    require("../../../assets/images/sutyerak/gondolkodik.png") as number,
};
