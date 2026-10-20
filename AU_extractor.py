import errno, os, stat, shutil
import time
import subprocess
import pandas as pd
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import threading
from FaceChannel.FaceChannelV1.FaceChannelV1 import FaceChannelV1
from FaceChannel.FaceChannelV1.imageProcessingUtil import imageProcessingUtil
import cv2
import numpy
from pymongo import MongoClient
from dotenv import load_dotenv
import dns

env_path = './server/.env'

load_dotenv(dotenv_path=env_path)

mongo_uri = os.getenv("MONGODB_URL")
database_name = os.getenv("MONGODB_DB_NAME")
collection_name = "current_state"

client = MongoClient(mongo_uri)
mongo_db = client[database_name]
collection = mongo_db[collection_name]

faceChannelDim = FaceChannelV1("Dim", loadModel=True)

imageProcessing = imageProcessingUtil()

faceSize = (64,64) # Input size for both models: categorical and dimensional

# Path to the parent folder
parent_folder = "./server/webcamBase"
# Path to OpenFace FeatureExtraction executable
openface_exe = "./openFace/FaceLandmarkImg.exe"
# Path to the directory where CSV files will be saved
csv_output_dir = "./server/action_units"

def chmod_fix(path):
    os.chmod(path, stat.S_IRWXU| stat.S_IRWXG| stat.S_IRWXO) # 0777

def handleRemoveReadonly(func, path, exc):
  excvalue = exc[1]
  if func in (os.rmdir, os.remove) and excvalue.errno == errno.EACCES:
      os.chmod(path, stat.S_IRWXU| stat.S_IRWXG| stat.S_IRWXO) # 0777
      func(path)
  else:
      raise

def add_or_update_data(id_value, data):
    try:
        # Check if the document with the specified id exists
        existing_document = collection.find_one({"id": id_value})

        if existing_document:
            # If the document exists, update the existing data
            updated_valence = existing_document["valence"] + data[0]
            updated_arousal = existing_document["arousal"] + data[1]
            count = existing_document["count"] + 1
            result = collection.update_one(
                {"id": id_value},
                {"$set": {"valence": updated_valence, "arousal": updated_arousal, "count": count}}
            )
            if result.modified_count > 0:
                print(f"Updated data for id '{id_value}': valence={updated_valence}, arousal={updated_arousal}")
            else:
                print(f"Failed to update data for id '{id_value}'.")
        else:
            # If the document does not exist, insert new data
            result = collection.insert_one({"id": id_value, "valence": data[0], "arousal": data[1], "count": 1})
            if result.inserted_id:
                print(f"Inserted new data for id '{id_value}': valence={data[0]}, arousal={data[1]}")
            else:
                print(f"Failed to insert data for id '{id_value}'.")
    except Exception as e:
        print(f"An error occurred: {e}")

class ChildFolderHandler(FileSystemEventHandler):
    def __init__(self):
        super().__init__()
        self.active_processes = {}

    def on_created(self, event):
        if event.is_directory:
            child_folder = event.src_path
            if child_folder not in self.active_processes:
                thread = threading.Thread(target=process_child_folder, args=(child_folder,))
                thread.start()
                self.active_processes[child_folder] = thread

def process_child_folder(child_folder):
    child_folder_name = os.path.basename(child_folder)
    child_folder_name = child_folder_name.split("_")
    output_csv = os.path.join(csv_output_dir, child_folder_name[1])
    if os.path.isdir(output_csv):
        pass
    else:
        os.mkdir(output_csv)
    mongo_key = child_folder_name[0]
    output_csv = os.path.join(output_csv, f"{child_folder_name[0]}.csv")
    print(output_csv)
    last_image_time = time.time()

    while True:
        current_time = time.time()
        if current_time - last_image_time > 20:
            #print("we are here now")
            # No new images for more than 5 seconds, delete the folder and exit
            for file in os.listdir(child_folder):
                file_path = os.path.join(child_folder, file)
                if os.path.isfile(file_path):
                    #shutil.rmtree(file_path, ignore_errors=False, onerror=handleRemoveReadonly)
                    chmod_fix(file_path)
                    os.remove(file_path)
            print("One conversation completed")
            shutil.rmtree(child_folder, ignore_errors=False, onerror=handleRemoveReadonly)
            break

        for file in os.listdir(child_folder):
            file_path = os.path.join(child_folder, file)
            if os.path.isfile(file_path) and (file.endswith(".jpg") or file.endswith(".png")):
                process_image(file_path, output_csv, current_time, mongo_key)
                chmod_fix(file_path)
                os.remove(file_path)
                last_image_time = current_time

        time.sleep(1)  # Check for new images every second

def process_image(image_path, output_csv, current_time, mongo_key):
    output_dir = os.path.join(os.path.dirname(image_path), "temp_output")
    os.makedirs(output_dir, exist_ok=True)

    # Run OpenFace FeatureExtraction tool
    
    #subprocess.run([openface_exe, "-f", image_path, "-out_dir", output_dir])
    
    print("working 1")
    frame = cv2.imread(image_path)
    # detect faces
    facePoints, face = imageProcessing.detectFace(frame)
    face = imageProcessing.preProcess(face, faceSize)
    # Obtain dimensional classification
    dimensionalRecognition = numpy.array(faceChannelDim.predict(face, preprocess=False))
    # Read the generated CSV file

    """
    csv_name = os.path.basename(image_path)
    csv_name = csv_name[:-4]
    output_file = os.path.join(output_dir, f"{csv_name}.csv")
    print(output_file)
    data_to_send = []
    if os.path.exists(output_file):
        print("working 2")
        df = pd.read_csv(output_file)
        df['arousal'] = dimensionalRecognition[0][0][0]
        df['valence'] = dimensionalRecognition[1][0][0]
        df['filename'] = os.path.basename(image_path)
        df['timeStamp'] = time.ctime(int(current_time))
        """
    data_to_send.append(float(dimensionalRecognition[1][0][0]))
    data_to_send.append(float(dimensionalRecognition[0][0][0]))

    add_or_update_data(mongo_key, data_to_send)


    """
        if not os.path.exists(output_csv):
            df.to_csv(output_csv, index=False)
            #print("file written")
        else:
            df.to_csv(output_csv, mode='a', header=False, index=False)
            #print("file written")
    """

    # Clean up temporary output directory
    """
    for file in os.listdir(output_dir):
        if os.path.isfile(os.path.join(output_dir, file)):
        #chmod_fix(os.path.join(output_dir, file))
        #os.remove(os.path.join(output_dir, file))
        shutil.rmtree(os.path.join(output_dir, file), ignore_errors=False, onerror=handleRemoveReadonly)
    """
    shutil.rmtree(output_dir, ignore_errors=False, onerror=handleRemoveReadonly)

if __name__ == "__main__":
    event_handler = ChildFolderHandler()
    observer = Observer()
    observer.schedule(event_handler, path=parent_folder, recursive=False)
    observer.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
