import { FileItemType } from '../../common/file-item-type.dto';

export interface LocationPhotoPresignDto {
  locationId: number;
  type: FileItemType;
  name: string;
}
