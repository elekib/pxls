import type { IconType } from "react-icons";
import {
  MdAccessTime, MdDescription, MdEdit, MdEmojiEvents, MdImage, MdLightbulb, MdMemory, MdMusicNote, MdPalette,
  MdPhotoLibrary, MdSportsEsports, MdThermostat, MdWatch,
} from "react-icons/md";

/** Icon for each page type, shown next to `typeLabels`. */
export const typeIcons: Record<string, IconType> = {
  ClockWeather: MdAccessTime,
  SystemStats: MdMemory,
  GpuStats: MdSportsEsports,
  Temps: MdThermostat,
  CustomScript: MdDescription,
  ImageUpload: MdImage,
  CustomPixels: MdPalette,
  CustomText: MdEdit,
  DivoomEnvironment: MdWatch,
  DivoomLight: MdLightbulb,
  DivoomMusic: MdMusicNote,
  DivoomUser: MdPhotoLibrary,
  DivoomScore: MdEmojiEvents,
};
